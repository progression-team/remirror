import { useCallback, useMemo, useState } from 'react';
import { isEmptyArray, take } from '@remirror/core';
import {
  EmojiExtension,
  EmojiSuggestHandler,
  EmojiSuggestHandlerCommand,
  EmojiSuggestHandlerProps,
  FlatEmoji,
} from '@remirror/extension-emoji';
import { useExtensionEvent, useHelpers } from '@remirror/react-core';

import {
  MenuNavigationOptions,
  useMenuNavigation,
  UseMenuNavigationReturn,
} from './use-menu-navigation';

export interface FlatEmojiWithUrl extends FlatEmoji {
  /**
   * The svg url for CDN access.
   */
  url: string;
}

export interface EmojiState extends Pick<EmojiSuggestHandlerProps, 'range' | 'query'> {
  /**
   * The list of emoji generated by the query.
   *
   * @defaultValue []
   */
  list: FlatEmojiWithUrl[];

  /**
   * The command to run to replace the query with the request emoji.
   *
   * @defaultValue undefined
   */
  apply: EmojiSuggestHandlerCommand;
}

export interface UseEmojiProps extends MenuNavigationOptions {}

export interface UseEmojiReturn extends UseMenuNavigationReturn<FlatEmojiWithUrl> {
  /**
   * The state of the current query, only available when active.
   */
  state: EmojiState | null;
}

const emptyEmoji: never[] = [];

/**
 * This hook provides the state for setting up an emoji state change handler. It
 * applies the keybindings and the required change handlers.
 */
export function useEmoji(props: UseEmojiProps = {}): UseEmojiReturn {
  const { direction, dismissKeys, focusOnClick, submitKeys } = props;
  const [state, setState] = useState<EmojiState | null>(null);
  const helpers = useHelpers();
  const items = state?.list ?? emptyEmoji;
  const isOpen = !!state;

  const onDismiss = useCallback(() => {
    if (!state) {
      return false;
    }

    // Ignore the current mention so that it doesn't show again for this
    // matching area
    helpers
      .getSuggestMethods()
      .addIgnored({ from: state.range.from, name: 'emoji', specific: true });

    setState(null);
    return true;
  }, [helpers, state]);

  const onSubmit = useCallback(
    (emoji: FlatEmojiWithUrl) => {
      if (!state || isEmptyArray(state.list)) {
        return false;
      }

      state.apply(emoji.emoji);

      return true;
    },
    [state],
  );

  const menu = useMenuNavigation<FlatEmojiWithUrl>({
    items,
    isOpen,
    onDismiss,
    onSubmit,
    direction,
    dismissKeys,
    focusOnClick,
    submitKeys,
  });
  const { setIndex } = menu;

  const onChange: EmojiSuggestHandler = useCallback(
    (props) => {
      const { change, exit, query, moji, apply, range } = props;

      if (change) {
        setIndex(0);
        setState({
          list: take(moji.search(query), 20).map((emoji) => ({ ...emoji, url: moji.url(emoji) })),
          apply: (code) => {
            setState(null);
            return apply(code);
          },
          range,
          query,
        });
      }

      if (exit) {
        setState(null);
      }
    },
    [setIndex],
  );

  // Add the change handler to the emoji state.
  useExtensionEvent(EmojiExtension, 'suggestEmoji', onChange);

  return useMemo(() => ({ ...menu, state }), [menu, state]);
}
