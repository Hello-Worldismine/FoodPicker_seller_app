import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useApp } from '../store/appStore';

export default function NoticeListScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { notices } = useApp();

  const sorted = [...notices].sort((a, b) => b.date.localeCompare(a.date));

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
        <View style={{ backgroundColor: '#fff', marginTop: 16, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', elevation: 1 }}>
          {sorted.map((notice, idx) => (
            <TouchableOpacity
              key={notice.id}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('NoticeDetail', { noticeId: notice.id })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 16,
                borderBottomWidth: idx < sorted.length - 1 ? 1 : 0,
                borderBottomColor: '#F3F4F6',
              }}
            >
              <Text style={{ fontSize: 22, marginRight: 12 }}>{notice.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#1F2933', marginBottom: 4 }}>
                  {notice.title}
                </Text>
                <Text style={{ fontSize: 12, color: '#9CA3AF' }}>{notice.date}</Text>
              </View>
              <ChevronRight color="#D1D5DB" size={18} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: insets.bottom + 32 }} />
      </ScrollView>
    </View>
  );
}
