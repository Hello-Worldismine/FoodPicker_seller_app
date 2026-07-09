import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useApp, formatReviewDate } from '../store/appStore';
import {
  ChevronLeft,
  Star,
  MessageSquare,
  AlertCircle,
  X,
  Trash2,
} from 'lucide-react-native';

function StarRow({ rating, size = 14 }) {
  return (
    <View className="flex-row gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={size}
          color={i <= rating ? '#FBBF24' : '#E5E7EB'}
          fill={i <= rating ? '#FBBF24' : 'transparent'}
        />
      ))}
    </View>
  );
}

export default function ReviewsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { reviews, updateReviewReply } = useApp();

  const [editModal, setEditModal] = useState(null); // { reviewId, text }
  const [replyText, setReplyText] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const totalCount = reviews.length;
  const repliedCount = reviews.filter(r => r.ownerReply).length;
  const avgRating = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : '0.0';
  const unansweredCount = reviews.filter(r => !r.ownerReply).length;

  function openEdit(review) {
    setReplyText(review.ownerReply || '');
    setEditModal(review);
  }

  function handleSave() {
    if (!editModal) return;
    updateReviewReply(editModal.id, replyText.trim());
    setEditModal(null);
    setReplyText('');
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    updateReviewReply(deleteConfirm.id, null);
    setDeleteConfirm(null);
    setEditModal(null);
    setReplyText('');
  }

  return (
    <View className="flex-1 bg-softgray">
      {/* Header */}
      <View
        className="bg-white px-4 pb-3 border-b border-gray-100 flex-row items-center"
        style={{ paddingTop: insets.top + 12 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 p-1">
          <ChevronLeft color="#1F2933" size={24} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-charcoal">리뷰 관리</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Summary Stats */}
        <View className="mx-4 mt-4 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
          <View className="flex-row gap-4">
            <View className="flex-1 items-center">
              <Text className="text-3xl font-bold text-charcoal">{avgRating}</Text>
              <StarRow rating={Math.round(parseFloat(avgRating))} size={16} />
              <Text className="text-xs text-gray-400 mt-1">평균 평점</Text>
            </View>
            <View className="w-px bg-gray-100" />
            <View className="flex-1 items-center">
              <Text className="text-3xl font-bold text-charcoal">{totalCount}</Text>
              <Text className="text-xs text-gray-400 mt-1">전체 리뷰</Text>
            </View>
            <View className="w-px bg-gray-100" />
            <View className="flex-1 items-center">
              <Text className="text-3xl font-bold text-primary">{repliedCount}</Text>
              <Text className="text-xs text-gray-400 mt-1">답변 완료</Text>
            </View>
          </View>
        </View>

        {/* Unanswered Banner */}
        {unansweredCount > 0 && (
          <View className="mx-4 mt-3 bg-orange/10 border border-orange/20 rounded-xl p-4 flex-row items-center gap-3">
            <AlertCircle color="#FF8A3D" size={18} />
            <Text className="text-orange font-semibold text-sm flex-1">
              미답변 리뷰 {unansweredCount}건이 있습니다
            </Text>
          </View>
        )}

        {/* Review List */}
        <View className="px-4 mt-3">
          {reviews.map(review => (
            <View
              key={review.id}
              className="bg-white rounded-xl mb-3 overflow-hidden shadow-sm"
              style={{ elevation: 1 }}
            >
              <View className="p-4">
                {/* Reviewer info */}
                <View className="flex-row items-start justify-between mb-2">
                  <View className="flex-row items-center gap-2">
                    <View className="w-8 h-8 bg-primary rounded-full items-center justify-center">
                      <Text className="text-white text-xs font-bold">
                        {review.user.charAt(0)}
                      </Text>
                    </View>
                    <View>
                      <Text className="font-semibold text-charcoal text-sm">{review.user}</Text>
                      <Text className="text-gray-400 text-xs">{formatReviewDate(review.createdAt)}</Text>
                    </View>
                  </View>
                  <StarRow rating={review.rating} />
                </View>

                {/* Review text */}
                <Text className="text-gray-700 text-sm leading-5 mb-3">{review.text}</Text>

                {/* Helpful count */}
                <View className="flex-row items-center gap-1 mb-3">
                  <Text className="text-gray-400 text-xs">도움이 됐어요 {review.helpful}</Text>
                </View>

                {/* Owner Reply */}
                {review.ownerReply && (
                  <View className="border-l-4 border-primary bg-mint rounded-r-lg pl-3 pr-3 py-3 mb-3">
                    <Text className="text-primary text-xs font-semibold mb-1">사장님 답변</Text>
                    <Text className="text-charcoal text-sm leading-5">{review.ownerReply}</Text>
                  </View>
                )}

                {/* Answer / Edit Button */}
                <TouchableOpacity
                  onPress={() => openEdit(review)}
                  className="flex-row items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-200"
                >
                  <MessageSquare color={review.ownerReply ? '#22A06B' : '#9AA3AF'} size={14} />
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: review.ownerReply ? '#22A06B' : '#9AA3AF' }}
                  >
                    {review.ownerReply ? '답변 수정' : '답변하기'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <View className="h-6" />
      </ScrollView>

      {/* Reply Editor Modal (bottom sheet style) */}
      <Modal visible={!!editModal} transparent animationType="slide" onRequestClose={() => setEditModal(null)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            className="flex-1 bg-black/40"
            activeOpacity={1}
            onPress={() => setEditModal(null)}
          />
          <View className="bg-white rounded-t-2xl" style={{ paddingBottom: insets.bottom + 8 }}>
            {/* Sheet Header */}
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
              <Text className="font-bold text-charcoal text-[15px]">
                {editModal?.ownerReply ? '답변 수정' : '답변 작성'}
              </Text>
              <TouchableOpacity onPress={() => setEditModal(null)} className="p-1">
                <X color="#9AA3AF" size={20} />
              </TouchableOpacity>
            </View>

            {/* Review preview */}
            {editModal && (
              <View className="mx-4 mt-3 bg-softgray rounded-lg p-3">
                <View className="flex-row items-center gap-1 mb-1">
                  <StarRow rating={editModal.rating} size={12} />
                  <Text className="text-gray-400 text-xs ml-1">{editModal.user}</Text>
                </View>
                <Text className="text-gray-600 text-sm" numberOfLines={2}>{editModal.text}</Text>
              </View>
            )}

            {/* Text input */}
            <View className="mx-4 mt-3">
              <TextInput
                className="bg-softgray rounded-xl px-4 py-3 text-charcoal text-sm"
                placeholder="고객 리뷰에 대한 답변을 작성해주세요 (최대 300자)"
                placeholderTextColor="#9AA3AF"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={300}
                value={replyText}
                onChangeText={setReplyText}
                style={{ minHeight: 100 }}
              />
              <Text className="text-right text-xs text-gray-400 mt-1">{replyText.length}/300</Text>
            </View>

            {/* Buttons */}
            <View className="flex-row gap-3 mx-4 mt-3">
              {editModal?.ownerReply && (
                <TouchableOpacity
                  className="flex-row items-center justify-center gap-1.5 px-4 py-3 border border-alertred rounded-xl"
                  onPress={() => setDeleteConfirm(editModal)}
                >
                  <Trash2 color="#E5484D" size={15} />
                  <Text className="text-alertred font-semibold text-sm">삭제</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
                onPress={() => setEditModal(null)}
              >
                <Text className="text-gray-600 font-semibold">취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-primary rounded-xl py-3 items-center"
                onPress={handleSave}
                disabled={!replyText.trim()}
                style={{ opacity: replyText.trim() ? 1 : 0.5 }}
              >
                <Text className="text-white font-semibold">저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-charcoal mb-2 text-center">답변 삭제</Text>
            <Text className="text-gray-500 text-sm text-center leading-5 mb-5">
              작성한 답변을 삭제하시겠습니까?{'\n'}삭제된 내용은 복구할 수 없습니다.
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
                onPress={() => setDeleteConfirm(null)}
              >
                <Text className="text-gray-600 font-semibold">취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-alertred rounded-xl py-3 items-center"
                onPress={handleDelete}
              >
                <Text className="text-white font-semibold">삭제</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
