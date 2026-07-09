import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import { useApp } from '../store/appStore';

export default function NoticeDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { noticeId } = route.params || {};
  const { notices } = useApp();

  const notice = notices.find(n => n.id === noticeId);

  if (!notice) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F5F6F7', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#9CA3AF', fontSize: 14 }}>공지사항을 찾을 수 없습니다.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      <View style={{
        backgroundColor: '#fff',
        paddingTop: insets.top + 14,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        flexDirection: 'row',
        alignItems: 'center',
      }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 12, padding: 2 }}>
          <ChevronLeft color="#1F2933" size={22} />
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#1F2933' }}>공지사항</Text>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ backgroundColor: '#fff', margin: 16, borderRadius: 16, overflow: 'hidden', padding: 20, elevation: 1 }}>
          <Text style={{ fontSize: 24, marginBottom: 10 }}>{notice.emoji}</Text>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#1F2933', lineHeight: 26, marginBottom: 6 }}>
            {notice.title}
          </Text>
          <Text style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 18 }}>{notice.date}</Text>
          <View style={{ height: 1, backgroundColor: '#F3F4F6', marginBottom: 18 }} />
          <Text style={{ fontSize: 14, color: '#374151', lineHeight: 24 }}>{notice.content}</Text>
        </View>
        <View style={{ height: insets.bottom + 32 }} />
      </ScrollView>
    </View>
  );
}
