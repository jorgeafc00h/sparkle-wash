export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  citations?: CitationInfo[];
  metadata?: Record<string, unknown>;
}

export interface CitationInfo {
  title: string;
  url?: string;
  source?: string;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  isActive: boolean;
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
}

export interface ChatConnectionState {
  isConnected: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  error?: string;
}

export interface ChatUIState {
  messages: ChatMessage[];
  currentMessage: string;
  currentSessionId: string;
  isTyping: boolean;
  connectionState: ChatConnectionState;
  error?: string;
  suggestions: string[];
  showingSuggestions: boolean;
}

export interface SessionResponse {
  success: boolean;
  data?: ChatSession;
  message?: string;
}

export interface MessageResponse {
  success: boolean;
  data?: ChatMessage;
  message?: string;
}

export interface UploadResponse {
  success: boolean;
  data?: DocumentUploadStatus;
  message?: string;
}

export interface SessionJoinedEvent {
  sessionId: string;
  messages: ChatMessage[];
}

export interface ChatConfiguration {
  apiBaseUrl: string;
  signalrUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

export interface CreateChatSessionInput {
  userId: string;
  title?: string;
  contactName?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface ChatApiCitation {
  documentId: string;
  filename: string;
  pageNumber: number;
  quote: string;
  fullMatch: string;
  confidence: number;
}

export interface ChatApiMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  timestamp: string;
  citations?: ChatApiCitation[];
  metadata?: Record<string, unknown>;
}

export interface ChatApiSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  isActive: boolean;
  messages?: ChatApiMessage[];
  metadata?: Record<string, unknown>;
}

export interface ChatCompletionResponse {
  messageId: string;
  content: string;
  citations?: ChatApiCitation[];
  timestamp: string;
  isComplete: boolean;
}

export interface DocumentUploadStatus {
  documentId: string;
  fileName: string;
  status: string;
  createdAt: string;
  processedAt?: string | null;
  errorMessage?: string | null;
  processedChunks: number;
  totalChunks: number;
  progressPercentage: number;
}

// Error Support Chat - Context passed when initiating support from error modal
export interface ErrorChatMetadata {
  source: 'error_modal';
  errorMessage: string;
  errorTitle: string;
  timestamp: string;
  companyNit?: string;
  companyName?: string;
  userId: string;
  platform: 'react-native-android' | 'react-native-ios';
  appVersion: string;
  environment: '00' | '01'; // Test vs Production
  screenContext?: string; // Screen where error occurred
}

// Error context for FancyErrorModal
export interface ErrorContext {
  errorTitle: string;
  errorMessage: string;
  timestamp: string;
  screenContext?: string;
  additionalData?: Record<string, unknown>;
}
