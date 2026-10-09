import axios from "axios";

const BASE = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? "http://localhost:5000/api" : "https://bimabima-kenyare.onrender.com/api");

const api = axios.create({ baseURL: BASE });
export default api;
