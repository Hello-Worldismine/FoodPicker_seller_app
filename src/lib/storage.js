// Supabase Storage 이미지 업로드 (Expo)
//
// [배경] 예전 구현은 URI 확장자를 그대로 경로에 붙이면서 contentType 은 png/webp 가 아니면
//        무조건 'image/jpeg' 로 넣었다. iOS 사진앱에서 고른 HEIC 파일이
//        `....heic` 경로 + `image/jpeg` MIME 으로 업로드되어(확장자·MIME 불일치),
//        Android RN <Image> 와 Chrome(관리자웹)이 디코딩하지 못하고 빈칸으로 보였다.
//        → 업로드 직전 항상 JPEG 로 재인코딩하고, 재인코딩이 불가능하면
//          화이트리스트 밖 형식을 조용히 넘기지 않고 한국어 에러로 막는다.
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

const BUCKET = 'product-images';

// 업로드를 허용하는 확장자 → MIME. 여기 없는 형식(heic/heif/tiff/avif …)은
// 판매자앱·사용자앱·관리자웹 모두에서 렌더가 보장되지 않으므로 받지 않는다.
const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// 확장자를 소문자로 뽑는다(쿼리스트링 제거). 없으면 ''.
function extOf(uri) {
  const m = String(uri).split('?')[0].split('#')[0].match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// 항상 JPEG 로 재인코딩한다. 성공하면 확장자·MIME 이 jpg 로 고정되므로
// 원본이 HEIC 든 무엇이든 렌더 불가 문제가 근본적으로 사라진다.
// (네이티브 모듈이 없는 환경 등 실패 시 null → 호출측이 원본 경로로 폴백)
async function reencodeToJpeg(uri) {
  try {
    // expo-image-manipulator 는 네이티브 모듈이라 dev client 를 다시 빌드하지 않은 환경에서
    // top-level import 가 즉시 throw 한다 → 지연 require + try/catch 로 감싸 폴백을 살린다.
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
    const image = await ImageManipulator.manipulate(uri).renderAsync();
    const result = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.85,
      base64: true,
    });
    const base64 = result?.base64
      || (result?.uri ? await FileSystem.readAsStringAsync(result.uri, { encoding: 'base64' }) : null);
    return base64 ? { base64, ext: 'jpg' } : null;
  } catch (e) {
    console.warn('[image reencode]', e?.message || e);
    return null;
  }
}

// 업로드 가능한 { base64, ext } 를 만든다. 재인코딩 우선, 실패 시 화이트리스트 검사.
async function readAsUploadable(uri) {
  const jpeg = await reencodeToJpeg(uri);
  if (jpeg) return jpeg;

  const ext = extOf(uri);
  if (!MIME_BY_EXT[ext]) {
    throw new Error(
      `지원하지 않는 이미지 형식입니다${ext ? ` (.${ext})` : ''}.\n` +
      'JPG·PNG·WEBP 형식의 사진으로 다시 선택해주세요.'
    );
  }
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  return { base64, ext };
}

// 로컬 파일 URI면 Storage에 업로드하고 public URL 반환. 이미 http(s) URL이면 그대로 반환.
export async function uploadImageIfLocal(uri, sellerId, folder = 'products') {
  if (!uri || /^https?:\/\//.test(uri)) return uri;
  const uid = sellerId || (await supabase.auth.getUser()).data.user?.id;
  if (!uid) throw new Error('로그인 세션이 없습니다.');

  const { base64, ext } = await readAsUploadable(uri);
  const arraybuffer = decode(base64);

  // 경로 확장자와 contentType 은 항상 같은 형식을 가리켜야 한다.
  const contentType = MIME_BY_EXT[ext];
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

// 이미 DB에 저장된 URL이 앱에서 렌더 불가한 형식인지(과거 HEIC 업로드 잔재) 판정.
// <Image onError> 폴백과 함께 '다시 업로드' 안내를 선제적으로 띄우는 데 쓴다.
export function isUnsupportedImageUrl(url) {
  if (!url) return false;
  const ext = extOf(url);
  return !!ext && !MIME_BY_EXT[ext];
}
