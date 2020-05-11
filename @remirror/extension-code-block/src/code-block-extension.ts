import refractor from 'refractor/core';

import {
  convertCommand,
  ExtensionFactory,
  findNodeAtSelection,
  findParentNodeOfType,
  GetAttributes,
  getMatchString,
  isElementDOMNode,
  isNodeActive,
  isTextSelection,
  mod,
  nodeEqualsType,
  NodeGroup,
  nodeInputRule,
  removeNodeAtPosition,
  toggleBlockItem,
} from '@remirror/core';
import { setBlockType } from '@remirror/pm/commands';
import { keydownHandler } from '@remirror/pm/keymap';
import { Plugin, TextSelection } from '@remirror/pm/state';

import { CodeBlockState } from './code-block-plugin';
import {
  CodeBlockAttributes,
  CodeBlockExtensionProperties,
  CodeBlockExtensionSettings,
} from './code-block-types';
import {
  codeBlockToDOM,
  dataAttribute,
  formatCodeBlockFactory,
  getLanguage,
  updateNodeAttributes,
} from './code-block-utils';

export const CodeBlockExtension = ExtensionFactory.typed<
  CodeBlockExtensionSettings,
  CodeBlockExtensionProperties
>().node({
  name: 'codeBlock',
  defaultSettings: {
    supportedLanguages: [],
    keyboardShortcut: mod('ShiftAlt', 'f'),
  },
  defaultProperties: {
    toggleName: 'paragraph',
    formatter: () => undefined,
    syntaxTheme: 'atomDark',
    defaultLanguage: 'markup',
  },
  onCreate({ settings }) {
    return {
      beforeExtensionLoop() {
        for (const language of settings.supportedLanguages) {
          refractor.register(language);
        }
      },
    };
  },
  createNodeSchema({ properties }) {
    return {
      attrs: {
        language: { default: properties.defaultLanguage },
      },
      content: 'text*',
      marks: '',
      group: NodeGroup.Block,
      code: true,
      defining: true,
      isolating: true,
      draggable: false,
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full',
          getAttrs: (node) => {
            if (!isElementDOMNode(node)) {
              return false;
            }

            const codeElement = node.querySelector('code');

            if (!isElementDOMNode(codeElement)) {
              return false;
            }

            const language = codeElement.getAttribute(dataAttribute);
            return { language };
          },
        },
      ],
      toDOM: (node) => codeBlockToDOM(node, properties.defaultLanguage),
    };
  },

  createCommands({ type, schema, extension }) {
    return {
      /**
       * Call this method to toggle the code block.
       *
       * ```ts
       * actions.toggleCodeBlock({ language: 'ts' });
       * ```
       *
       * The above makes the current node a codeBlock with the language ts or remove the
       * code block altogether.
       */
      toggleCodeBlock: (attributes: Partial<CodeBlockAttributes>) =>
        convertCommand(
          toggleBlockItem({
            type,
            toggleType: schema().nodes[extension.properties.toggleName],
            attrs: { language: extension.properties.defaultLanguage, ...attributes },
          }),
        ),

      /**
       * Creates a code at the current position.
       *
       * ```ts
       * commands.createCodeBlock({ language: 'js' });
       * ```
       */
      createCodeBlock: (attributes: CodeBlockAttributes) =>
        convertCommand(setBlockType(type, attributes)),

      /**
       * Update the code block at the current position. Primarily this is used to change the language.
       *
       * ```ts
       * if (commands.updateCodeBlock.isEnabled()) {
       *   commands.updateCodeBlock({ language: 'markdown' });
       * }
       * ```
       */
      updateCodeBlock: updateNodeAttributes(type),

      /**
       * Format the code block with the code formatting function passed as an option.
       *
       * Code formatters (like prettier) add a lot to the bundle size and hence it is up to you
       * to provide a formatter which will be run on the entire code block when this method is used.
       *
       * ```ts
       * if (actions.formatCodeBlock.isActive()) {
       *   actions.formatCodeBlockFactory();
       *   // Or with a specific position
       *   actions.formatCodeBlock({ pos: 100 }) // to format a separate code block
       * }
       * ```
       */
      formatCodeBlock: (parameter) =>
        formatCodeBlockFactory({
          type,
          formatter: extension.properties.formatter,
          defaultLanguage: extension.properties.defaultLanguage,
        })(parameter),
    };
  },

  /**
   * Create an input rule that listens converts the code fence into a code block with space.
   */
  createInputRules({ type, extension }) {
    const regexp = /^```([\dA-Za-z]*) $/;
    const getAttributes: GetAttributes = (match) => {
      const language = getLanguage({
        language: getMatchString(match, 1),
        fallback: extension.properties.defaultLanguage,
      });

      return { language };
    };

    return [
      nodeInputRule({
        regexp,
        type,
        updateSelection: true,
        getAttributes: getAttributes,
      }),
    ];
  },

  createKeymap({ type, commands, extension }) {
    return {
      Tab: ({ state, dispatch }) => {
        const { selection, tr, schema } = state;
        // Check that this is the correct node.
        const { node } = findNodeAtSelection(selection);

        if (!nodeEqualsType({ node, types: type })) {
          return false;
        }

        if (selection.empty) {
          tr.insertText('\t');
        } else {
          const { from, to } = selection;
          tr.replaceWith(from, to, schema.text('\t'));
        }

        if (dispatch) {
          dispatch(tr);
        }

        return true;
      },
      Backspace: ({ state, dispatch }) => {
        const { selection } = state;

        // If the selection is not empty, return false and let other extension (ie: BaseKeymapExtension) to do
        // the deleting operation.
        if (!selection.empty) {
          return false;
        }

        let tr = state.tr;

        // Check that this is the correct node.
        const parent = findParentNodeOfType({ types: type, selection });

        if (parent?.start !== selection.from) {
          return false;
        }

        const { pos, node, start } = parent;

        if (node.textContent.trim() === '') {
          tr = removeNodeAtPosition({ pos, tr });
        } else if (start - 2 > 0) {
          // Make the cursor jump to the previous node.
          tr.setSelection(TextSelection.create(tr.doc, start - 2));
        } else {
          // There is no content before the codeBlock so simply create a new block and jump into it.
          tr.insert(0, state.schema.nodes[extension.properties.toggleName].create());
          tr.setSelection(TextSelection.create(tr.doc, 1));
        }

        if (dispatch) {
          dispatch(tr);
        }
        return true;
      },
      Enter: ({ state, dispatch }) => {
        const { selection, tr } = state;
        if (!isTextSelection(selection) || !selection.$cursor) {
          return false;
        }

        const { nodeBefore } = selection.$from;

        if (!nodeBefore || !nodeBefore.isText) {
          return false;
        }

        const regex = /^```([A-Za-z]*)?$/;
        const { text } = nodeBefore;

        if (!text) {
          return false;
        }

        const matches = text.match(regex);

        if (!matches) {
          return false;
        }

        const [, lang] = matches;

        const language = getLanguage({
          language: lang,
          fallback: extension.properties.defaultLanguage,
        });

        const pos = selection.$from.before();
        const end = pos + nodeBefore.nodeSize + 1; // +1 to account for the extra pos a node takes up
        tr.replaceWith(pos, end, type.create({ language }));

        // Set the selection to within the codeBlock
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));

        if (dispatch) {
          dispatch(tr);
        }

        return true;
      },
      [extension.settings.keyboardShortcut]: ({ state }) => {
        const chain = commands<typeof extension>();

        if (!isNodeActive({ type, state })) {
          return false;
        }

        chain.formatCodeBlock().run();
        return true;
      },
    };
  },

  createPlugin({ type, key, extension }) {
    const pluginState = new CodeBlockState(type, extension);

    /** Handles deletions within the plugin state. */
    const handler = () => {
      pluginState.setDeleted(true);
      return false;
    };

    return new Plugin<CodeBlockState>({
      key,
      state: {
        init(_, state) {
          return pluginState.init(state);
        },
        apply(tr, _, oldState, newState) {
          return pluginState.apply({ tr, oldState, newState });
        },
      },
      props: {
        handleKeyDown: keydownHandler({
          Backspace: handler,
          'Mod-Backspace': handler,
          Delete: handler,
          'Mod-Delete': handler,
          'Ctrl-h': handler,
          'Alt-Backspace': handler,
          'Ctrl-d': handler,
          'Ctrl-Alt-Backspace': handler,
          'Alt-Delete': handler,
          'Alt-d': handler,
        }),
        // handleDOMEvents:
        decorations() {
          pluginState.setDeleted(false);
          return pluginState.decorationSet;
        },
      },
    });
  },
});

export { getLanguage };
