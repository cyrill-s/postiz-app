'use client';
import { PostComment, withProvider } from '../high.order.provider';

export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: null,
  maximumCharacters: 4000,
});
