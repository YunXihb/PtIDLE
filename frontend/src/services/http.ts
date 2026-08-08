import axios, { type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth';

// axios 实例：baseURL 用相对路径（开发期由 vite proxy 转发到后端 3000）
const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// 请求拦截：自动附带 JWT
http.interceptors.request.use((config) => {
  const auth = useAuthStore();
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

// 响应拦截：401 时登出并跳转登录页；统一返回 { success, data } 信封（不返回 AxiosResponse）
http.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      const auth = useAuthStore();
      auth.logout();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error.response?.data || error);
  }
);

/**
 * 类型化请求方法：拦截器已返回信封对象（非 AxiosResponse），
 * 故泛型 T 直接是「信封类型」，调用方 res.data 即业务数据。
 */
export const httpGet = <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
  http.get(url, config) as unknown as Promise<T>;

export const httpPost = <T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> =>
  http.post(url, body, config) as unknown as Promise<T>;

export const httpPut = <T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> =>
  http.put(url, body, config) as unknown as Promise<T>;

export const httpDelete = <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
  http.delete(url, config) as unknown as Promise<T>;

export default http;
