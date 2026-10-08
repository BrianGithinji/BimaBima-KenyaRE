import pandas as pd
df = pd.read_csv('nzoia_underwriter_loss_table.csv')
flooded = df[(df['return_period']==100) & (df['depth_m']>0)]
print('Flooded buildings at RP100:', len(flooded))
print('Lat range:', round(flooded['lat'].min(),4), '-', round(flooded['lat'].max(),4))
print('Lon range:', round(flooded['lon'].min(),4), '-', round(flooded['lon'].max(),4))
print()
print('Sample flooded coords:')
print(flooded[['loc_id','lat','lon','depth_m']].head(10).to_string())
print()
# Check distance from PDF coords
import numpy as np
pdf_lat, pdf_lon = 0.6234, 34.5687
flooded2 = flooded.copy()
flooded2['dist'] = np.hypot(flooded2['lat']-pdf_lat, flooded2['lon']-pdf_lon)
nearest = flooded2.nsmallest(5,'dist')[['loc_id','lat','lon','depth_m','dist']]
print('Nearest flooded buildings to PDF coords (0.6234, 34.5687):')
print(nearest.to_string())
