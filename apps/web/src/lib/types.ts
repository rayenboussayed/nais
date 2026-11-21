import type { operations } from '../../../../generated/api';
import type { components } from '../../../../generated/ws';

/** AI message row returned by the audit endpoints. */
export type AiMessage =
  operations['AiMessagesController_findAll']['responses'][200]['content']['application/json']['items'][number];

/** Prompt row returned by the AI-message prompts endpoint. */
export type AiMessagePrompt =
  operations['AiMessagesController_findPrompts']['responses'][200]['content']['application/json'][number];

/** Task descriptor returned by GET /api/ai/tasks. */
export type AiTaskDescriptor =
  operations['AiController_tasks']['responses'][200]['content']['application/json']['items'][number];

/** Fully resolved (createdAt, id) cursor returned by any API list response. */
export type KeysetCursor = NonNullable<LanguageList['next']>;

/** Keyset page envelope whose row type is supplied by the caller. */
export type KeysetList<T> = Omit<LanguageList, 'items'> & { items: T[] };

/** Language row returned by the languages endpoints. */
export type Language = LanguageList['items'][number];

/** Login response returned by POST /api/auth/login. */
export type LoginResponse =
  operations['AuthController_login']['responses'][200]['content']['application/json'];

/** Translation row returned by the translations endpoints. */
export type Translation =
  operations['TranslationsController_findAll']['responses'][200]['content']['application/json']['items'][number];

/** Server ack for the WebSocket `translate` message. */
export type WsTranslateAck = components['schemas']['WsTranslateAck'];

/** Client `translate` WebSocket message. */
export type WsTranslateMessage = components['schemas']['WsTranslateMessage'];

/** Server `translation-error` WebSocket event. */
export type WsTranslationErrorEvent = components['schemas']['WsTranslationErrorEvent'];

/** Server `translation` WebSocket event. */
export type WsTranslationEvent = components['schemas']['WsTranslationEvent'];

/** Keyset page envelope from the languages list; the cursor shape is shared by every list. */
type LanguageList =
  operations['LanguagesController_findAll']['responses'][200]['content']['application/json'];
