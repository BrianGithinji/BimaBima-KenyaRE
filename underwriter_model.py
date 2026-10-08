"""
Nzoia Basin Flood Underwriter Model
====================================
Pipeline (per STEP_BY_STEP_GUIDE.md):
  Hazard       -> sample flood depth from 6 JRC GeoTIFF rasters
  Vulnerability-> ML1: GBR learned damage curve (trained on CSV actuals)
  Exposure     -> 500 synthetic buildings (lat/lon, housing class, TIV)
  Financial    -> loss per building per RP, EP curve, AAL, premium pricing

ML layers added:
  ML1 - GradientBoostingRegressor: learns damage_ratio from depth + class
  ML2 - RandomForestClassifier   : predicts flooded/dry from building features
  ML3 - IsolationForest          : anomaly detection on loss features
"""

import numpy as np
import pandas as pd
import rasterio
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker
from matplotlib.lines import Line2D
from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier, IsolationForest
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.model_selection import cross_val_score
from sklearn.metrics import classification_report, mean_absolute_error, r2_score
import warnings
warnings.filterwarnings("ignore")

# ── CONFIG ────────────────────────────────────────────────────────────────────

RASTERS = {
    10:  "nzoia_rp10y.tif",
    20:  "nzoia_rp20y.tif",
    50:  "nzoia_rp50y.tif",
    100: "nzoia_rp100y.tif",
    200: "nzoia_rp200y.tif",
    500: "nzoia_rp500y.tif",
}
LOADING_FACTOR  = 1.35
DEDUCTIBLE_RATE = 0.02
TIER_BINS   = [0.00, 0.05, 0.20, 0.45, 1.01]
TIER_LABELS = ["Low", "Medium", "High", "Decline"]
TIER_COLORS = {"Low": "#2ecc71", "Medium": "#f1c40f",
               "High": "#e67e22", "Decline": "#e74c3c"}

# ── STAGE 1: HAZARD — sample depth from TIFs ─────────────────────────────────

def sample_depth(lon, lat, dataset):
    row, col = dataset.index(lon, lat)
    if row < 0 or col < 0 or row >= dataset.height or col >= dataset.width:
        return 0.0
    val = float(dataset.read(1)[row, col])
    nd  = dataset.nodata
    if nd is not None and val == nd:
        return 0.0
    return max(0.0, val)


def build_hazard_table(exposure_df):
    records = []
    open_rasters = {rp: rasterio.open(path) for rp, path in RASTERS.items()}
    for _, bldg in exposure_df.iterrows():
        for rp, src in open_rasters.items():
            depth = sample_depth(bldg["lon"], bldg["lat"], src)
            records.append({
                "loc_id":        bldg["loc_id"],
                "lat":           bldg["lat"],
                "lon":           bldg["lon"],
                "housing_class": bldg["housing_class"],
                "floor_area_m2": bldg["floor_area_m2"],
                "tiv_kes":       bldg["tiv_kes"],
                "return_period": rp,
                "aep":           1.0 / rp,
                "depth_m":       depth,
            })
    for src in open_rasters.values():
        src.close()
    return pd.DataFrame(records)


# ── ML1: LEARNED DAMAGE CURVE (GradientBoostingRegressor) ────────────────────
#
# Trains on the CSV's actual damage_ratio values (flooded rows only).
# Features: depth_m + housing_class (one-hot).
# Replaces the hand-tuned JRC logistic with a data-driven curve.

def train_damage_model(csv_path="nzoia_complete_flood_loss_dataset.csv"):
    raw = pd.read_csv(csv_path)
    flooded = raw[raw["flood_depth_m"] > 0].copy()

    X = flooded[["flood_depth_m", "housing_class"]]
    y = flooded["damage_ratio"]

    pre = ColumnTransformer([
        ("depth", "passthrough", ["flood_depth_m"]),
        ("cls",   OneHotEncoder(sparse_output=False, handle_unknown="ignore"),
                  ["housing_class"]),
    ])
    model = Pipeline([
        ("pre",   pre),
        ("gbr",   GradientBoostingRegressor(
                      n_estimators=300, max_depth=4,
                      learning_rate=0.05, random_state=42)),
    ])
    model.fit(X, y)

    y_pred = model.predict(X)
    mae = mean_absolute_error(y, y_pred)
    r2  = r2_score(y, y_pred)
    cv  = cross_val_score(model, X, y, cv=5, scoring="r2").mean()

    print("\n[ML1 — Learned Damage Curve]  GradientBoostingRegressor")
    print(f"  Trained on {len(flooded)} flooded building-RP rows")
    print(f"  MAE={mae:.4f}  R2={r2:.4f}  CV-R2={cv:.4f}")
    return model


def predict_damage_ratio(model, depth_m, housing_class):
    if depth_m <= 0:
        return 0.0
    X = pd.DataFrame({"flood_depth_m": [depth_m], "housing_class": [housing_class]})
    return float(np.clip(model.predict(X)[0], 0.0, 1.0))


# ── ML2: FLOOD CLASSIFIER (RandomForestClassifier) ───────────────────────────
#
# Predicts flooded (1) / dry (0) at RP100 from building features alone
# (lat, lon, floor_area_m2, tiv_kes, housing_class).
# Trained on raster-sampled ground truth labels.

def train_flood_classifier(hazard_df):
    rp100 = hazard_df[hazard_df["return_period"] == 100].copy()
    rp100["flooded"] = (rp100["depth_m"] > 0).astype(int)

    X = rp100[["lat", "lon", "floor_area_m2", "tiv_kes", "housing_class"]]
    y = rp100["flooded"]

    pre = ColumnTransformer([
        ("num", "passthrough", ["lat", "lon", "floor_area_m2", "tiv_kes"]),
        ("cls", OneHotEncoder(sparse_output=False, handle_unknown="ignore"),
                ["housing_class"]),
    ])
    model = Pipeline([
        ("pre", pre),
        ("rf",  RandomForestClassifier(
                    n_estimators=200, max_depth=8,
                    class_weight="balanced", random_state=42)),
    ])
    model.fit(X, y)

    y_pred = model.predict(X)
    cv_f1  = cross_val_score(model, X, y, cv=5, scoring="f1").mean()

    print("\n[ML2 — Flood Classifier]  RandomForestClassifier")
    print(f"  Trained on {len(rp100)} buildings at RP100 "
          f"({y.sum()} flooded / {(y==0).sum()} dry)")
    print(f"  CV F1={cv_f1:.4f}")
    print(classification_report(y, y_pred,
          target_names=["Dry", "Flooded"], zero_division=0))
    return model


def score_flood_probability(clf, exposure_df):
    X = exposure_df[["lat", "lon", "floor_area_m2", "tiv_kes", "housing_class"]]
    proba = clf.predict_proba(X)[:, 1]
    return proba


# ── ML3: ANOMALY DETECTION (IsolationForest) ─────────────────────────────────
#
# Fits on flooded buildings' loss features at RP100.
# Flags buildings whose loss profile is statistically unusual —
# useful for underwriting data-quality review and fraud detection.

def train_anomaly_detector(loss_df):
    rp100_flooded = loss_df[
        (loss_df["return_period"] == 100) & (loss_df["depth_m"] > 0)
    ].copy()

    features = ["depth_m", "damage_ratio", "gross_loss_kes",
                "net_loss_kes", "tiv_kes"]
    X = rp100_flooded[features]

    iso = IsolationForest(n_estimators=200, contamination=0.10, random_state=42)
    iso.fit(X)

    rp100_flooded["anomaly_score"] = iso.decision_function(X)
    rp100_flooded["is_anomaly"]    = iso.predict(X) == -1

    n_anomalies = rp100_flooded["is_anomaly"].sum()
    print("\n[ML3 — Anomaly Detection]  IsolationForest")
    print(f"  Fitted on {len(rp100_flooded)} flooded buildings at RP100")
    print(f"  Flagged {n_anomalies} anomalies (contamination=10%)")
    if n_anomalies > 0:
        anom = rp100_flooded[rp100_flooded["is_anomaly"]].sort_values("anomaly_score")
        print("  Top 5 anomalies (lowest score = most anomalous):")
        cols = ["loc_id", "housing_class", "depth_m",
                "damage_ratio", "net_loss_kes", "anomaly_score"]
        print(anom[cols].head(5).to_string(index=False))

    return iso, rp100_flooded[["loc_id", "anomaly_score", "is_anomaly"]]


# ── FINANCIAL ENGINE ──────────────────────────────────────────────────────────

def compute_losses(hazard_df, damage_model):
    df = hazard_df.copy()
    df["damage_ratio"] = df.apply(
        lambda r: predict_damage_ratio(damage_model, r["depth_m"], r["housing_class"]),
        axis=1,
    )
    df["gross_loss_kes"] = df["damage_ratio"] * df["tiv_kes"]
    df["deductible_kes"] = np.minimum(df["tiv_kes"] * DEDUCTIBLE_RATE,
                                      df["gross_loss_kes"])
    df["net_loss_kes"]   = df["gross_loss_kes"] - df["deductible_kes"]
    return df


def ep_curve(loss_df):
    ep = (
        loss_df.groupby("return_period")
        .agg(
            aep              = ("aep",           "first"),
            total_tiv        = ("tiv_kes",        "sum"),
            flooded_bldgs    = ("depth_m",        lambda x: (x > 0).sum()),
            avg_damage_ratio = ("damage_ratio",   "mean"),
            gross_loss       = ("gross_loss_kes", "sum"),
            net_loss         = ("net_loss_kes",   "sum"),
        )
        .reset_index()
        .sort_values("return_period")
    )
    ep["loss_ratio"] = ep["net_loss"] / ep["total_tiv"]
    return ep


def compute_aal(ep_df):
    s        = ep_df.sort_values("aep")
    aep_pts  = np.concatenate([[0.0], s["aep"].values])
    loss_pts = np.concatenate([[0.0], s["net_loss"].values])
    return float(np.trapezoid(loss_pts, aep_pts))


def premium_pricing(ep_df, total_tiv):
    aal           = compute_aal(ep_df)
    pure_rate     = aal / total_tiv
    gross_rate    = pure_rate * LOADING_FACTOR
    gross_premium = total_tiv * gross_rate
    return {"aal": aal, "pure_rate": pure_rate,
            "gross_rate": gross_rate, "gross_premium": gross_premium}


def assign_tiers(loss_df):
    rp100 = loss_df[loss_df["return_period"] == 100].copy()
    rp100["risk_tier"] = pd.cut(rp100["damage_ratio"],
                                bins=TIER_BINS, labels=TIER_LABELS, right=True)
    return rp100


# ── PLOTS ─────────────────────────────────────────────────────────────────────

def plot_ml1_curves(damage_model):
    """Learned damage curves vs depth, one line per housing class."""
    depths  = np.linspace(0, 6, 300)
    classes = ["informal_iron_sheet", "semi_permanent",
               "permanent_masonry", "concrete_rcc"]
    styles  = ["-", "--", "-.", ":"]
    fig, ax = plt.subplots(figsize=(7, 4))
    for cls, ls in zip(classes, styles):
        dr = [predict_damage_ratio(damage_model, d, cls) for d in depths]
        ax.plot(depths, dr, ls, lw=2, label=cls.replace("_", " ").title())
    ax.set_xlabel("Flood Depth (m)")
    ax.set_ylabel("Damage Ratio")
    ax.set_title("ML1: Learned Depth-Damage Curves (GBR)")
    ax.legend(fontsize=9)
    ax.grid(True, alpha=0.3)
    ax.set_ylim(0, 1)
    return fig


def plot_ep_curve(ep_df):
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(ep_df["return_period"], ep_df["net_loss"] / 1e9,
            "o-", color="steelblue", lw=2, ms=7)
    for _, row in ep_df.iterrows():
        ax.annotate(f"{row.net_loss/1e9:.2f}B",
                    (row.return_period, row.net_loss / 1e9),
                    textcoords="offset points", xytext=(4, 6), fontsize=8)
    ax.set_xlabel("Return Period (years)")
    ax.set_ylabel("Portfolio Net Loss (KES Billion)")
    ax.set_title("EP Curve — Nzoia Basin (ML1 damage ratios)")
    ax.set_xscale("log")
    ax.set_xticks(ep_df["return_period"].tolist())
    ax.get_xaxis().set_major_formatter(matplotlib.ticker.ScalarFormatter())
    ax.grid(True, alpha=0.3)
    return fig


def plot_ml2_flood_probability(exposure_df, flood_proba):
    """Scatter of buildings coloured by ML2 flood probability."""
    fig, ax = plt.subplots(figsize=(8, 6))
    sc = ax.scatter(exposure_df["lon"], exposure_df["lat"],
                    c=flood_proba, cmap="RdYlGn_r",
                    vmin=0, vmax=1, s=12, alpha=0.8)
    plt.colorbar(sc, ax=ax, label="Flood Probability (ML2)")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.set_title("ML2: Predicted Flood Probability per Building (RP100)")
    ax.grid(True, alpha=0.2)
    return fig


def plot_ml3_anomalies(loss_df, anomaly_df):
    """Scatter of flooded buildings at RP100, anomalies highlighted."""
    rp100 = loss_df[
        (loss_df["return_period"] == 100) & (loss_df["depth_m"] > 0)
    ].merge(anomaly_df, on="loc_id", how="left")

    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.suptitle("ML3: Anomaly Detection on Flooded Buildings (RP100)",
                 fontsize=12, fontweight="bold")

    # depth vs net loss
    normal  = rp100[~rp100["is_anomaly"]]
    anomaly = rp100[rp100["is_anomaly"]]
    axes[0].scatter(normal["depth_m"],  normal["net_loss_kes"]  / 1e6,
                    c="steelblue", s=20, alpha=0.6, label="Normal")
    axes[0].scatter(anomaly["depth_m"], anomaly["net_loss_kes"] / 1e6,
                    c="red", s=50, marker="x", lw=1.5, label="Anomaly")
    axes[0].set_xlabel("Flood Depth (m)")
    axes[0].set_ylabel("Net Loss (KES M)")
    axes[0].set_title("Depth vs Net Loss")
    axes[0].legend()
    axes[0].grid(True, alpha=0.3)

    # anomaly score distribution
    axes[1].hist(rp100["anomaly_score"], bins=20, color="steelblue",
                 edgecolor="white", alpha=0.8)
    axes[1].axvline(0, color="red", lw=1.5, linestyle="--",
                    label="Decision boundary")
    axes[1].set_xlabel("Anomaly Score (lower = more anomalous)")
    axes[1].set_ylabel("Count")
    axes[1].set_title("Anomaly Score Distribution")
    axes[1].legend()
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    return fig


def plot_hazard_maps(exposure_df, loss_df):
    rps_to_show = [10, 100, 500]
    fig, axes   = plt.subplots(1, 3, figsize=(16, 5))
    fig.suptitle("Nzoia Flood Hazard Maps with Portfolio Locations",
                 fontsize=12, fontweight="bold")
    for ax, rp in zip(axes, rps_to_show):
        with rasterio.open(RASTERS[rp]) as src:
            data   = src.read(1).astype(float)
            nd     = src.nodata
            data[data == nd] = np.nan
            data[data <= 0]  = np.nan
            bounds = src.bounds
            extent = [bounds.left, bounds.right, bounds.bottom, bounds.top]
        im = ax.imshow(data, extent=extent, origin="upper",
                       cmap="Blues", vmin=0, vmax=5, aspect="auto")
        plt.colorbar(im, ax=ax, label="Depth (m)", fraction=0.03)
        rp_loss = loss_df[loss_df["return_period"] == rp]
        merged  = exposure_df[["loc_id", "lat", "lon"]].merge(
            rp_loss[["loc_id", "damage_ratio"]], on="loc_id", how="left"
        )
        merged["damage_ratio"] = merged["damage_ratio"].fillna(0)
        merged["tier"] = pd.cut(merged["damage_ratio"],
                                bins=TIER_BINS, labels=TIER_LABELS, right=True)
        merged["tier"] = merged["tier"].cat.add_categories("Dry").fillna("Dry")
        tier_color_map = {**TIER_COLORS, "Dry": "#aaaaaa"}
        for tier, grp in merged.groupby("tier", observed=True):
            ax.scatter(grp["lon"], grp["lat"],
                       c=tier_color_map[tier], s=8, alpha=0.7,
                       label=tier, zorder=5)
        ax.set_title(f"RP {rp}yr")
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
    handles = [Line2D([0], [0], marker="o", color="w",
                      markerfacecolor=c, markersize=7, label=t)
               for t, c in {**TIER_COLORS, "Dry": "#aaaaaa"}.items()]
    fig.legend(handles=handles, title="Risk Tier", loc="lower center",
               ncol=5, bbox_to_anchor=(0.5, -0.02), fontsize=9)
    plt.tight_layout()
    return fig


def plot_tier_breakdown(tier_df):
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    counts = tier_df["risk_tier"].value_counts().reindex(TIER_LABELS).fillna(0)
    axes[0].bar(counts.index, counts.values,
                color=[TIER_COLORS[t] for t in counts.index])
    axes[0].set_title("Building Count by Risk Tier (1-in-100yr)")
    axes[0].set_ylabel("Number of Buildings")
    axes[0].grid(True, alpha=0.3, axis="y")
    tiv_at_risk = (
        tier_df[tier_df["damage_ratio"] > 0]
        .groupby("risk_tier", observed=True)["tiv_kes"].sum() / 1e9
    ).reindex(TIER_LABELS).fillna(0)
    axes[1].bar(tiv_at_risk.index, tiv_at_risk.values,
                color=[TIER_COLORS[t] for t in tiv_at_risk.index])
    axes[1].set_title("TIV at Risk by Tier (1-in-100yr, KES Billion)")
    axes[1].set_ylabel("TIV (KES Billion)")
    axes[1].grid(True, alpha=0.3, axis="y")
    plt.tight_layout()
    return fig


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  NZOIA BASIN FLOOD UNDERWRITER MODEL  (with ML layers)")
    print("  ML1: Learned damage curve  | GradientBoostingRegressor")
    print("  ML2: Flood classifier      | RandomForestClassifier")
    print("  ML3: Anomaly detection     | IsolationForest")
    print("=" * 60)

    # Load exposure
    raw      = pd.read_csv("nzoia_complete_flood_loss_dataset.csv")
    exposure = (raw[["loc_id", "lat", "lon", "housing_class",
                      "floor_area_m2", "cost_per_m2_kes", "tiv_kes"]]
                .drop_duplicates("loc_id"))
    print(f"\n[Exposure]  {len(exposure)} synthetic buildings loaded")
    print(f"  TIV range : KES {exposure['tiv_kes'].min()/1e6:.1f}M"
          f" - {exposure['tiv_kes'].max()/1e6:.0f}M")
    print(f"  Class mix : {dict(exposure['housing_class'].value_counts())}")

    # ML1 — train damage model before hazard sampling
    damage_model = train_damage_model()

    # Stage 1 — hazard from TIFs
    print("\n[Hazard]  Sampling flood depths from 6 JRC GeoTIFF rasters...")
    hazard = build_hazard_table(exposure)
    print(f"  Total building-RP combinations : {len(hazard)}")
    print(f"  Flooded (depth > 0)            : {(hazard['depth_m'] > 0).sum()}")
    for rp in sorted(RASTERS):
        sub = hazard[hazard["return_period"] == rp]
        n   = (sub["depth_m"] > 0).sum()
        med = sub[sub["depth_m"] > 0]["depth_m"].median()
        print(f"    RP {rp:>3}yr: {n:>3} flooded | median depth {med:.2f}m")

    # ML2 — flood classifier (trained on raster ground truth)
    flood_clf   = train_flood_classifier(hazard)
    flood_proba = score_flood_probability(flood_clf, exposure)

    # Stage 2+3 — ML1 damage ratios -> losses
    print("\n[Vulnerability + Loss]  Using ML1 predicted damage ratios...")
    loss_df = compute_losses(hazard, damage_model)

    # ML3 — anomaly detection on flooded buildings
    _, anomaly_df = train_anomaly_detector(loss_df)

    # EP curve
    ep_df = ep_curve(loss_df)
    print("\n[EP Curve]")
    print(f"  {'RP (yr)':<10} {'AEP':<8} {'Flooded':<10} {'Avg DR':<10}"
          f" {'Net Loss (KES B)':<20} {'Loss Ratio'}")
    print("  " + "-" * 65)
    for _, row in ep_df.iterrows():
        print(f"  {int(row.return_period):<10} {row.aep:<8.4f}"
              f" {int(row.flooded_bldgs):<10} {row.avg_damage_ratio:<10.4f}"
              f" {row.net_loss/1e9:<20.3f} {row.loss_ratio:.5f}")

    # Premium pricing
    total_tiv = exposure["tiv_kes"].sum()
    pricing   = premium_pricing(ep_df, total_tiv)
    print("\n[Premium Pricing]")
    print(f"  Total Portfolio TIV  : KES {total_tiv/1e9:.2f}B")
    print(f"  AAL (modelled)       : KES {pricing['aal']/1e6:.1f}M")
    print(f"  Pure Premium Rate    : {pricing['pure_rate']*100:.4f}%")
    print(f"  Gross Rate (x{LOADING_FACTOR})   : {pricing['gross_rate']*100:.4f}%")
    print(f"  Gross Annual Premium : KES {pricing['gross_premium']/1e6:.1f}M")

    # Risk tiers
    tier_df      = assign_tiers(loss_df)
    tier_summary = (
        tier_df.groupby("risk_tier", observed=True)
        .agg(buildings        = ("loc_id",       "count"),
             avg_tiv_kes      = ("tiv_kes",       "mean"),
             avg_damage_ratio = ("damage_ratio",  "mean"),
             total_net_loss   = ("net_loss_kes",  "sum"))
        .reindex(TIER_LABELS)
    )
    print("\n[Risk Tiers at 1-in-100yr]")
    print(f"  {'Tier':<10} {'Buildings':<12} {'Avg TIV (M)':<15}"
          f" {'Avg DR':<10} {'Net Loss (M)'}")
    print("  " + "-" * 60)
    for tier, row in tier_summary.iterrows():
        if pd.isna(row["buildings"]):
            continue
        action = {"Low":     "Accept at standard rate",
                  "Medium":  "Accept with flood endorsement",
                  "High":    "Accept — sub-limit + higher deductible",
                  "Decline": "Decline / refer to facultative reinsurance"}[tier]
        print(f"  {tier:<10} {int(row.buildings):<12}"
              f" {row.avg_tiv_kes/1e6:<15.1f}"
              f" {row.avg_damage_ratio:<10.4f}"
              f" {row.total_net_loss/1e6:.1f}M  ->  {action}")

    # Plots
    print("\n[Plots]  Generating...")
    plot_ml1_curves(damage_model).savefig(
        "01_ml1_damage_curves.png", dpi=150, bbox_inches="tight")
    plot_ep_curve(ep_df).savefig(
        "02_ep_curve.png", dpi=150, bbox_inches="tight")
    plot_ml2_flood_probability(exposure, flood_proba).savefig(
        "03_ml2_flood_probability.png", dpi=150, bbox_inches="tight")
    plot_ml3_anomalies(loss_df, anomaly_df).savefig(
        "04_ml3_anomalies.png", dpi=150, bbox_inches="tight")
    plot_hazard_maps(exposure, loss_df).savefig(
        "05_hazard_maps.png", dpi=150, bbox_inches="tight")
    plot_tier_breakdown(tier_df).savefig(
        "06_risk_tiers.png", dpi=150, bbox_inches="tight")
    for f in ["01_ml1_damage_curves.png", "02_ep_curve.png",
              "03_ml2_flood_probability.png", "04_ml3_anomalies.png",
              "05_hazard_maps.png", "06_risk_tiers.png"]:
        print(f"  Saved: {f}")

    # Save outputs
    loss_df[["loc_id", "lat", "lon", "housing_class", "tiv_kes",
             "return_period", "aep", "depth_m", "damage_ratio",
             "gross_loss_kes", "deductible_kes", "net_loss_kes"]].to_csv(
        "nzoia_underwriter_loss_table.csv", index=False)

    exposure.assign(flood_probability_rp100=flood_proba).merge(
        anomaly_df.rename(columns={"anomaly_score": "ml3_anomaly_score",
                                   "is_anomaly":    "ml3_flag"}),
        on="loc_id", how="left"
    ).to_csv("nzoia_underwriter_portfolio.csv", index=False)

    print("  Saved: nzoia_underwriter_loss_table.csv")
    print("  Saved: nzoia_underwriter_portfolio.csv")
    print("\nDone.")


if __name__ == "__main__":
    main()
