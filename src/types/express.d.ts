declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
      sessionId?: string;
      /** Set when the request was authenticated with an API key instead of a session token. */
      apiKey?: {
        id: string;
        scope: 'READ_ONLY' | 'READ_WRITE';
      };
    }
  }
}

export {};
