// 주소 → 좌표(위경도) 변환기.
//
// [배경] 판매자앱은 Daum 우편번호로 "주소 문자열"만 받아 stores.address 에 저장해왔고
//        stores.lat/lng 는 한 번도 채우지 않았다. 그 결과 사용자앱의
//        지도 화면 · 가게 상세 매장정보 지도 · 상품상세 픽업장소 지도가 모두
//        "위치 정보가 없습니다" 로 표시됐다(NaverMap 은 lat/lng null 이면 폴백).
//
// [방식] 네이버 지도 Web Dynamic Map JS SDK 의 geocoder 서브모듈을 WebView 안에서 사용한다.
//        REST 지오코딩(NCP)과 달리 시크릿 키가 필요 없고(도메인 제한 방식),
//        사용자앱 NaverMap.js 와 동일한 클라이언트 ID · baseUrl 을 그대로 쓴다.
//
// [사용법]
//   const geoRef = useRef(null);
//   ...
//   <NaverGeocoder ref={geoRef} />
//   const coords = await geoRef.current.geocode('서울 동대문구 겸재로 16'); // { lat, lng } | null
//
// 실패(키 미설정·인증 실패·검색결과 없음)해도 null 을 돌려줄 뿐 흐름을 막지 않는다.
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

const CLIENT_ID = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID;
// NCP 콘솔 'Web 서비스 URL' 에 등록된 도메인 — 사용자앱 NaverMap.js 와 동일해야 인증된다.
const NAVER_WEB_SERVICE_URL = 'https://foodpicker.app';
const TIMEOUT_MS = 8000;

const HTML = `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
</head><body>
<script>
  function post(o){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var READY = false;
  var QUEUE = [];
  window.navermap_authFailure = function(){ post({ type:'authfail' }); };

  function runGeocode(id, query){
    try {
      naver.maps.Service.geocode({ query: query }, function(status, response){
        if (status !== naver.maps.Service.Status.OK) { post({ id:id, error:'geocode_failed' }); return; }
        var list = (response && response.v2 && response.v2.addresses) || [];
        if (!list.length) { post({ id:id, error:'not_found' }); return; }
        // 네이버 응답은 x=경도, y=위도.
        post({ id:id, lat: parseFloat(list[0].y), lng: parseFloat(list[0].x) });
      });
    } catch (e) { post({ id:id, error:'exception:' + (e && e.message) }); }
  }

  // RN 에서 호출되는 진입점. SDK 로드 전 호출은 큐에 쌓아 두고 ready 시 처리.
  window.__fpGeocode = function(id, query){
    if (READY) runGeocode(id, query); else QUEUE.push([id, query]);
  };
</script>
<script src="https://openapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CLIENT_ID}&submodules=geocoder"></script>
<script>
  try {
    if (window.naver && naver.maps && naver.maps.Service) {
      READY = true;
      post({ type:'ready' });
      QUEUE.splice(0).forEach(function(q){ runGeocode(q[0], q[1]); });
    } else {
      post({ type:'error', message:'geocoder submodule missing' });
    }
  } catch (e) { post({ type:'error', message: e && e.message }); }
</script>
</body></html>`;

const NaverGeocoder = forwardRef(function NaverGeocoder(_props, ref) {
  const webRef = useRef(null);
  const pending = useRef(new Map()); // id → { resolve, timer }
  const seq = useRef(0);

  const settle = useCallback((id, value) => {
    const entry = pending.current.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.current.delete(id);
    entry.resolve(value);
  }, []);

  const geocode = useCallback((address) => {
    const query = (address || '').trim();
    if (!CLIENT_ID || !query || !webRef.current) return Promise.resolve(null);

    const id = `g${++seq.current}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(id, null), TIMEOUT_MS);
      pending.current.set(id, { resolve, timer });
      webRef.current.injectJavaScript(
        `window.__fpGeocode(${JSON.stringify(id)}, ${JSON.stringify(query)}); true;`
      );
    });
  }, [settle]);

  useImperativeHandle(ref, () => ({ geocode, available: !!CLIENT_ID }), [geocode]);

  function handleMessage(event) {
    let msg;
    try { msg = JSON.parse(event.nativeEvent.data); } catch (e) { return; }
    if (msg.id) {
      settle(msg.id, msg.error ? null : { lat: msg.lat, lng: msg.lng });
      return;
    }
    if (msg.type === 'authfail' || msg.type === 'error') {
      // 인증 실패 시 대기 중인 요청을 모두 즉시 실패 처리(타임아웃 대기 없이).
      console.warn('[NaverGeocoder]', msg.type, msg.message || '');
      Array.from(pending.current.keys()).forEach(id => settle(id, null));
    }
  }

  if (!CLIENT_ID) return null;

  return (
    <View style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }} pointerEvents="none">
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: NAVER_WEB_SERVICE_URL }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        style={{ width: 1, height: 1, opacity: 0 }}
      />
    </View>
  );
});

export default NaverGeocoder;
