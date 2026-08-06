// 고객센터 — 사용자 어플(foodpicker_app) 마이 탭 > 고객센터(SupportScreen.js)와 동일한 구성으로 통일.
// 기존에는 Store.jsx 안 모달에 전화/이메일 버튼만 있었는데, 1:1 문의 작성 + 문의 내역 확인이 안 됐다.
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Phone, Mail, MessageSquare, Clock, ChevronRight } from 'lucide-react-native';

const CHANNELS = [
  { key: 'inquiry', Icon: MessageSquare, label: '1:1 문의', desc: '문의 내역 확인 및 작성', screen: 'InquiryList' },
  { key: 'email', Icon: Mail, label: '이메일 문의', desc: 'foodpicker77@gmail.com', onPress: () => Linking.openURL('mailto:foodpicker77@gmail.com') },
  { key: 'phone', Icon: Phone, label: '전화 상담', desc: '1800-8018', onPress: () => Linking.openURL('tel:18008018') },
];

export default function SupportScreen({ navigation }) {
  return (
    <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
      <View className="flex-row items-center justify-between bg-white px-4 py-3.5 border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation.goBack()} className="w-10">
          <ArrowLeft color="#1F2933" size={22} />
        </TouchableOpacity>
        <Text className="text-[17px] font-extrabold text-charcoal">고객센터</Text>
        <View className="w-10" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-start gap-3 bg-mint rounded-2xl p-4 mb-6">
          <Clock color="#22A06B" size={16} />
          <View className="flex-1">
            <Text className="text-xs font-bold text-primary mb-1">운영 시간</Text>
            <Text className="text-xs text-primary leading-5">평일 09:00 ~ 18:00{'\n'}주말·공휴일 휴무</Text>
          </View>
        </View>

        <Text className="text-xs font-bold text-gray-400 mb-2">상담 채널</Text>
        <View className="bg-white rounded-2xl overflow-hidden mb-5">
          {CHANNELS.map((ch, idx) => {
            const Icon = ch.Icon;
            return (
              <TouchableOpacity
                key={ch.key}
                className={`flex-row items-center gap-3 px-4 py-4 ${idx < CHANNELS.length - 1 ? 'border-b border-gray-100' : ''}`}
                activeOpacity={0.7}
                onPress={ch.screen ? () => navigation.navigate(ch.screen) : ch.onPress}
              >
                <View className="w-10 h-10 rounded-xl bg-mint items-center justify-center">
                  <Icon color="#22A06B" size={18} />
                </View>
                <View className="flex-1">
                  <Text className="text-[15px] font-bold text-charcoal mb-0.5">{ch.label}</Text>
                  <Text className="text-xs text-gray-400">{ch.desc}</Text>
                </View>
                <ChevronRight color="#9AA3AF" size={16} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
