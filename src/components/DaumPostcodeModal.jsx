import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { X } from 'lucide-react-native';

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body { background: #fff; }
</style>
</head>
<body>
<script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
<script>
function initPostcode() {
  if (!window.daum || !daum.Postcode) {
    setTimeout(initPostcode, 200);
    return;
  }
  new daum.Postcode({
    oncomplete: function(data) {
      var address = data.roadAddress || data.address;
      window.ReactNativeWebView.postMessage(JSON.stringify({ address: address }));
    },
    width: '100%',
    height: '100%',
  }).embed(document.body);
}
window.onload = initPostcode;
</script>
</body>
</html>`;

export default function DaumPostcodeModal({ visible, onClose, onSelect }) {
  const insets = useSafeAreaInsets();

  function handleMessage(event) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.address) {
        onSelect(data.address);
        onClose();
      }
    } catch (e) {}
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#1F2933' }}>주소 검색</Text>
          <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
            <X color="#1F2933" size={22} />
          </TouchableOpacity>
        </View>
        <WebView
          source={{ html: HTML, baseUrl: 'https://postcode.map.daum.net' }}
          onMessage={handleMessage}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color="#22A06B" />
            </View>
          )}
          style={{ flex: 1 }}
        />
      </View>
    </Modal>
  );
}
