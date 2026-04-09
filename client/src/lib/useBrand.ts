/**
 * 前端品牌配置 hook
 *
 * 从 /api/brand 加载品牌配置，全局缓存。
 * 未加载完成前返回默认值（灵虾），保证零闪烁。
 */

import { useEffect, useState } from "react";
import { type BrandConfig, DEFAULT_BRAND } from "@shared/brand";

let _cache: BrandConfig | null = null;
let _promise: Promise<BrandConfig> | null = null;

function fetchBrand(): Promise<BrandConfig> {
  if (_promise) return _promise;
  _promise = fetch("/api/brand")
    .then((r) => (r.ok ? r.json() : DEFAULT_BRAND))
    .then((data: BrandConfig) => {
      _cache = data;
      return data;
    })
    .catch(() => {
      _cache = DEFAULT_BRAND;
      return DEFAULT_BRAND;
    });
  return _promise;
}

export function useBrand(): BrandConfig {
  const [brand, setBrand] = useState<BrandConfig>(_cache || DEFAULT_BRAND);

  useEffect(() => {
    if (_cache) {
      setBrand(_cache);
      return;
    }
    fetchBrand().then(setBrand);
  }, []);

  return brand;
}

/** 命令式获取（非 React 场景） */
export async function getBrand(): Promise<BrandConfig> {
  if (_cache) return _cache;
  return fetchBrand();
}

/** 强制刷新缓存（Admin 保存后调用） */
export function invalidateBrandClientCache(): void {
  _cache = null;
  _promise = null;
}
