import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';

import {
  debounce,
  EditorSchema,
  EditorState,
  ExtensionFactory,
  invariant,
  isArray,
  isNumber,
  PlainObject,
  ProsemirrorAttributes,
  Transaction,
  uniqueId,
} from '@remirror/core';
import { Step } from '@remirror/pm/transform';

export interface Sendable {
  version: number;
  steps: Array<Step<EditorSchema>>;
  clientID: number | string;
  origins: Transaction[];
}

export interface JSONSendable extends Omit<Sendable, 'steps' | 'origins'> {
  steps: PlainObject[];
}

export interface OnSendableReceivedParameter {
  /**
   * The raw sendable generated by the prosemirror-collab library.
   */
  sendable: Sendable;

  /**
   * A sendable which can be sent to a server
   */
  jsonSendable: JSONSendable;
}

export interface CollaborationExtensionSettings {
  /**
   * The document version.
   *
   * @defaultValue 0
   */
  version?: number;

  /**
   * The unique ID of the client connecting to the server.
   */
  clientID: number | string;

  /**
   * The debounce time in milliseconds
   *
   * @defaultValue 250
   */
  debounceMs?: number;
}

export interface CollaborationExtensionProperties {
  /**
   * Called when an an editor transaction occurs and there are changes ready to
   * be sent to the server.
   *
   * @remarks
   *
   * The callback will receive the `jsonSendable` which can be sent to the
   * server as it is. If you need more control then the `sendable` property can
   * be used to shape the data the way you require.
   *
   * Since this method is called for everyTransaction that updates the
   * jsonSendable value it is automatically debounced for you.
   *
   * @param params - the sendable and jsonSendable properties which can be sent
   * to your backend
   */
  onSendableReceived: (params: OnSendableReceivedParameter) => void;
}

export type CollaborationAttributes = ProsemirrorAttributes<{
  /**
   * @internalremarks
   * TODO give this some better types
   */
  steps: any[];

  /**
   * The version of the document that these steps were added to.
   */
  version: number;
}>;

/**
 * Check that the attributes exist and are valid for the collaboration update
 * command method.
 */
const isValidCollaborationAttributes = (
  attributes: ProsemirrorAttributes,
): attributes is CollaborationAttributes => {
  return !(!attributes || !isArray(attributes.steps) || !isNumber(attributes.version));
};

/**
 * The collaboration extension adds collaborative functionality to your editor.
 *
 * Once a central server is created the collaboration extension is good.
 */
export const CollaborationExtension = ExtensionFactory.typed<
  CollaborationExtensionSettings,
  CollaborationExtensionProperties
>().plain({
  name: 'collaboration',
  defaultSettings: {
    version: 0,
    clientID: uniqueId(),
    debounceMs: 250,
  },
  defaultProperties: {
    onSendableReceived() {},
  },
  createCommands({ schema }) {
    return {
      collaborationUpdate: (attributes: CollaborationAttributes) => ({ state, dispatch }) => {
        invariant(isValidCollaborationAttributes(attributes), {
          message: 'Invalid attributes passed to the collaboration command.',
        });

        const { version, steps } = attributes;

        if (getVersion(state) > version) {
          return false;
        }

        if (dispatch) {
          dispatch(
            receiveTransaction(
              state,
              steps.map((item) => Step.fromJSON(schema(), item.step)),
              steps.map((item) => item.clientID),
            ),
          );
        }

        return true;
      },
    };
  },
  createPlugin({ extension }) {
    const { version, clientID } = extension.settings;

    return collab({
      version,
      clientID,
    });
  },

  onTransaction(extension) {
    const handler = debounce(extension.settings.debounceMs, (state: EditorState) => {
      const sendable = sendableSteps(state);

      if (sendable) {
        const jsonSendable = {
          version: sendable.version,
          steps: sendable.steps.map((step) => step.toJSON()),
          clientID: sendable.clientID,
        };

        extension.properties.onSendableReceived({ sendable, jsonSendable });
      }
    });

    return ({ state }) => {
      handler(state);
    };
  },
});
