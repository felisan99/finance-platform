export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          cost_method: string
          created_at: string
          currency: string
          id: string
          name: string
          portfolio_id: string
          user_id: string
        }
        Insert: {
          cost_method?: string
          created_at?: string
          currency?: string
          id?: string
          name: string
          portfolio_id: string
          user_id: string
        }
        Update: {
          cost_method?: string
          created_at?: string
          currency?: string
          id?: string
          name?: string
          portfolio_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_portfolio_fk"
            columns: ["portfolio_id", "user_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      allowed_emails: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      assistant_conversations: {
        Row: {
          created_at: string
          id: string
          summarized_through: number
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          summarized_through?: number
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          summarized_through?: number
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_memory: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_messages: {
        Row: {
          conversation_id: string
          created_at: string
          message: Json
          role: string
          seq: number
          ui_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          message: Json
          role: string
          seq?: never
          ui_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          message?: Json
          role?: string
          seq?: never
          ui_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_fk"
            columns: ["conversation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      assistant_runs: {
        Row: {
          compacted: boolean
          context_tokens_after: number | null
          context_tokens_before: number | null
          conversation_id: string | null
          cost_usd: number | null
          created_at: string
          error_code: string | null
          fallback_used: boolean
          finish_reason: string | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          output_tokens: number | null
          steps: number
          tools: Json
          ttft_ms: number | null
          user_id: string
        }
        Insert: {
          compacted?: boolean
          context_tokens_after?: number | null
          context_tokens_before?: number | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          error_code?: string | null
          fallback_used?: boolean
          finish_reason?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          steps?: number
          tools?: Json
          ttft_ms?: number | null
          user_id: string
        }
        Update: {
          compacted?: boolean
          context_tokens_after?: number | null
          context_tokens_before?: number | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          error_code?: string | null
          fallback_used?: boolean
          finish_reason?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number | null
          steps?: number
          tools?: Json
          ttft_ms?: number | null
          user_id?: string
        }
        Relationships: []
      }
      corporate_actions: {
        Row: {
          amount: number | null
          ex_date: string
          id: string
          instrument_id: string
          ratio: number | null
          type: string
        }
        Insert: {
          amount?: number | null
          ex_date: string
          id?: string
          instrument_id: string
          ratio?: number | null
          type: string
        }
        Update: {
          amount?: number | null
          ex_date?: string
          id?: string
          instrument_id?: string
          ratio?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_actions_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          account_id: string | null
          created_at: string
          filename: string | null
          id: string
          report: Json | null
          rows_imported: number | null
          rows_skipped: number | null
          rows_total: number | null
          source: string
          undone_at: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          report?: Json | null
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          source: string
          undone_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          report?: Json | null
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          source?: string
          undone_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_account_fk"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      instruments: {
        Row: {
          created_at: string
          currency: string
          exchange: string | null
          history_backfilled_at: string | null
          history_from: string | null
          id: string
          industry: string | null
          name: string | null
          provider_symbol: string | null
          sector: string | null
          symbol: string
          type: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          exchange?: string | null
          history_backfilled_at?: string | null
          history_from?: string | null
          id?: string
          industry?: string | null
          name?: string | null
          provider_symbol?: string | null
          sector?: string | null
          symbol: string
          type?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          exchange?: string | null
          history_backfilled_at?: string | null
          history_from?: string | null
          id?: string
          industry?: string | null
          name?: string | null
          provider_symbol?: string | null
          sector?: string | null
          symbol?: string
          type?: string | null
        }
        Relationships: []
      }
      login_attempts: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      market_job_runs: {
        Row: {
          errors: Json
          finished_at: string | null
          id: string
          job: string
          started_at: string
          status: string
          summary: Json
        }
        Insert: {
          errors?: Json
          finished_at?: string | null
          id?: string
          job: string
          started_at?: string
          status?: string
          summary?: Json
        }
        Update: {
          errors?: Json
          finished_at?: string | null
          id?: string
          job?: string
          started_at?: string
          status?: string
          summary?: Json
        }
        Relationships: []
      }
      portfolios: {
        Row: {
          benchmark_symbol: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          benchmark_symbol?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          benchmark_symbol?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      prices_daily: {
        Row: {
          adj_close: number | null
          close: number
          date: string
          instrument_id: string
        }
        Insert: {
          adj_close?: number | null
          close: number
          date: string
          instrument_id: string
        }
        Update: {
          adj_close?: number | null
          close?: number
          date?: string
          instrument_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prices_daily_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          base_currency: string
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      quotes_latest: {
        Row: {
          as_of: string
          change: number | null
          change_pct: number | null
          fetched_at: string | null
          instrument_id: string
          price: number
        }
        Insert: {
          as_of: string
          change?: number | null
          change_pct?: number | null
          fetched_at?: string | null
          instrument_id: string
          price: number
        }
        Update: {
          as_of?: string
          change?: number | null
          change_pct?: number | null
          fetched_at?: string | null
          instrument_id?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_latest_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: true
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          user_id: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number | null
          created_at: string
          currency: string
          executed_at: string
          external_id: string | null
          fee: number
          id: string
          import_id: string | null
          instrument_id: string | null
          notes: string | null
          price: number | null
          quantity: number | null
          seq: number
          source: string
          split_ratio: number | null
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
        }
        Insert: {
          account_id: string
          amount?: number | null
          created_at?: string
          currency?: string
          executed_at: string
          external_id?: string | null
          fee?: number
          id?: string
          import_id?: string | null
          instrument_id?: string | null
          notes?: string | null
          price?: number | null
          quantity?: number | null
          seq?: never
          source?: string
          split_ratio?: number | null
          type: Database["public"]["Enums"]["tx_type"]
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number | null
          created_at?: string
          currency?: string
          executed_at?: string
          external_id?: string | null
          fee?: number
          id?: string
          import_id?: string | null
          instrument_id?: string | null
          notes?: string | null
          price?: number | null
          quantity?: number | null
          seq?: never
          source?: string
          split_ratio?: number | null
          type?: Database["public"]["Enums"]["tx_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_fk"
            columns: ["account_id", "user_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_import_fk"
            columns: ["import_id", "user_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist_items: {
        Row: {
          added_at: string
          instrument_id: string
          user_id: string
          watchlist_id: string
        }
        Insert: {
          added_at?: string
          instrument_id: string
          user_id: string
          watchlist_id: string
        }
        Update: {
          added_at?: string
          instrument_id?: string
          user_id?: string
          watchlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_items_instrument_id_fkey"
            columns: ["instrument_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watchlist_items_watchlist_fk"
            columns: ["watchlist_id", "user_id"]
            isOneToOne: false
            referencedRelation: "watchlists"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      watchlists: {
        Row: {
          id: string
          name: string
          user_id: string
        }
        Insert: {
          id?: string
          name?: string
          user_id: string
        }
        Update: {
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      widget_tokens: {
        Row: {
          created_at: string
          last_used_at: string | null
          portfolio_id: string | null
          quotes_attempted_at: string | null
          token_hash: string
          user_id: string
          window_count: number
          window_start: string
        }
        Insert: {
          created_at?: string
          last_used_at?: string | null
          portfolio_id?: string | null
          quotes_attempted_at?: string | null
          token_hash: string
          user_id: string
          window_count?: number
          window_start?: string
        }
        Update: {
          created_at?: string
          last_used_at?: string | null
          portfolio_id?: string | null
          quotes_attempted_at?: string | null
          token_hash?: string
          user_id?: string
          window_count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_tokens_portfolio_fk"
            columns: ["portfolio_id", "user_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      active_instruments: {
        Args: never
        Returns: {
          first_tx_date: string
          history_backfilled_at: string
          history_from: string
          in_watchlist: boolean
          instrument_id: string
          latest_price_date: string
          provider_symbol: string
          symbol: string
        }[]
      }
      clear_login_attempts: { Args: { p_key: string }; Returns: undefined }
      create_portfolio: {
        Args: { p_benchmark?: string; p_name: string }
        Returns: string
      }
      create_widget_token: {
        Args: { p_portfolio_id: string; p_token_hash: string }
        Returns: undefined
      }
      hook_before_user_created: { Args: { event: Json }; Returns: Json }
      import_transactions: {
        Args: {
          p_account_id: string
          p_filename: string
          p_report: Json
          p_rows: Json
          p_source: string
        }
        Returns: {
          duplicates: number
          import_id: string
          inserted: number
        }[]
      }
      instrument_prices: {
        Args: { p_instrument_ids: string[] }
        Returns: {
          instrument_id: string
          last_close: string
          last_date: string
          prev_close: string
          prev_date: string
        }[]
      }
      price_series: {
        Args: {
          p_adjusted: boolean
          p_from: string
          p_instrument_ids: string[]
        }
        Returns: {
          closes: string[]
          dates: string[]
          instrument_id: string
        }[]
      }
      recent_imports: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          filename: string
          import_id: string
          live_count: number
          portfolio_id: string
          rows_imported: number
          source: string
          undone_at: string
        }[]
      }
      take_login_attempt: { Args: { p_key: string }; Returns: boolean }
      take_rate_limit: { Args: { p_key: string }; Returns: boolean }
      take_widget_quote_refresh: {
        Args: { p_token_hash: string }
        Returns: boolean
      }
      undo_import: { Args: { p_import_id: string }; Returns: number }
      watchlist_market: {
        Args: { p_instrument_ids: string[]; p_points: number; p_since: string }
        Returns: {
          high_close: string
          instrument_id: string
          last_close: string
          last_date: string
          low_close: string
          prev_close: string
          prev_date: string
          recent: Json
        }[]
      }
      widget_ledger: {
        Args: { p_portfolio_name?: string; p_token_hash: string }
        Returns: Json
      }
    }
    Enums: {
      tx_type:
        | "BUY"
        | "SELL"
        | "DIVIDEND"
        | "DEPOSIT"
        | "WITHDRAWAL"
        | "FEE"
        | "INTEREST"
        | "SPLIT"
        | "TAX"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      tx_type: [
        "BUY",
        "SELL",
        "DIVIDEND",
        "DEPOSIT",
        "WITHDRAWAL",
        "FEE",
        "INTEREST",
        "SPLIT",
        "TAX",
      ],
    },
  },
} as const
