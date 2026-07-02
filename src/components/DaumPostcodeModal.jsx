import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { X } from 'lucide-react-native';

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #fff; }
</style>
</head>
<body>
<script src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
<script>
window.onload = function() {
  new daum.Postcode({
    oncomplete: function(data) {
      var address = data.roadAddress || data.address;
      window.ReactNativeWebView.postMessage(JSON.stringify({ address: address }));
    },
    width: '100%',
    height: '100%',
  }).embed(document.body);
};
</script>
</body>
</html>`;

export default function DaumPostcodeModal({ visible, onClose, onSelect }) {
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
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
          <Text className="text-lg font-bold text-charcoal">주소 검색</Text>
          <TouchableOpacity onPress={onClose} className="p-1">
            <X color="#1F2933" size={22} />
          </TouchableOpacity>
        </View>
        <WebView
          source={{ html: HTML }}
          onMessage={handleMessage}
          startInLoadingState
          renderLoading={() => (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color="#22A06B" />
            </View>
          )}
          style={{ flex: 1 }}
        />
      </SafeAreaView>
    </Modal>
  );
}
