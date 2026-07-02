import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';

export default function AppModal({
  isOpen,
  title,
  description,
  confirmLabel = '확인',
  onConfirm,
  onCancel,
  confirmDanger = false,
}) {
  return (
    <Modal visible={!!isOpen} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 bg-black/50 items-end justify-end">
        <View className="bg-white rounded-t-2xl w-full px-5 pt-6 pb-8">
          {/* Handle bar */}
          <View className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

          <Text className="text-[17px] font-bold text-charcoal mb-2">{title}</Text>
          {description ? (
            <Text className="text-[14px] text-gray-500 leading-relaxed mb-5">{description}</Text>
          ) : null}

          <View className="flex-row gap-3 mt-2">
            <TouchableOpacity
              className="flex-1 py-3.5 rounded-xl border border-gray-200 items-center"
              onPress={onCancel}
            >
              <Text className="text-[15px] font-semibold text-gray-600">취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 py-3.5 rounded-xl items-center"
              style={{ backgroundColor: confirmDanger ? '#E5484D' : '#22A06B' }}
              onPress={onConfirm}
            >
              <Text className="text-[15px] font-bold text-white">{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
