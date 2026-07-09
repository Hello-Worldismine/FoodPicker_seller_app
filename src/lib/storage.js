// Supabase Storage 이미지 업로드 (Expo)
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

const BUCKET = 'product-images';

// 로컬 파일 URI면 Storage에 업로드하고 public URL 반환. 이미 http(s) URL이면 그대로 반환.
export async function uploadImageIfLocal(uri, sellerId, folder = 'products') {
  if (!uri || /^https?:\/\//.test(uri)) return uri;
  const uid = sellerId || (await supabase.auth.getUser()).data.user?.id;
  if (!uid) throw new Error('로그인 세션이 없습니다.');

  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const arraybuffer = decode(base64);

  const extMatch = uri.split('?')[0].match(/\.(\w+)$/);
  const ext = (extMatch ? extMatch[1] : 'jpg').toLowerCase();
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `${uid}/${folder}/${Date.now()}_${Math.floor(Math.random() * 1e9)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, arraybuffer, { contentType, upsert: false });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// 여러 이미지: 로컬만 업로드, 실패 시 원본 URI 유지(등록 자체는 진행).
export async function uploadImages(uris, sellerId, folder = 'products') {
  const out = [];
  for (const u of uris || []) {
    try {
      out.push(await uploadImageIfLocal(u, sellerId, folder));
    } catch (e) {
      console.warn('[image upload]', e.message);
      out.push(u);
    }
  }
  return out;
}
