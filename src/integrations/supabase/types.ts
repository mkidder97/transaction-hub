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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          created_at: string
          failed_rows: number | null
          filename: string | null
          id: string
          imported_by: string | null
          imported_rows: number | null
          source: string
          status: string
          total_rows: number | null
        }
        Insert: {
          created_at?: string
          failed_rows?: number | null
          filename?: string | null
          id?: string
          imported_by?: string | null
          imported_rows?: number | null
          source: string
          status?: string
          total_rows?: number | null
        }
        Update: {
          created_at?: string
          failed_rows?: number | null
          filename?: string | null
          id?: string
          imported_by?: string | null
          imported_rows?: number | null
          source?: string
          status?: string
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          card_last_four: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          card_last_four?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Update: {
          card_last_four?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          ai_confidence: number | null
          ai_raw_text: string | null
          amount_confirmed: number | null
          amount_extracted: number | null
          category_id: string | null
          created_at: string
          date_confirmed: string | null
          date_extracted: string | null
          flag_reason: string | null
          id: string
          match_confidence: number | null
          match_status: string
          notes: string | null
          photo_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          statement_period_id: string | null
          status: string
          storage_path: string | null
          transaction_id: string | null
          updated_at: string
          user_id: string
          vendor_confirmed: string | null
          vendor_extracted: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_raw_text?: string | null
          amount_confirmed?: number | null
          amount_extracted?: number | null
          category_id?: string | null
          created_at?: string
          date_confirmed?: string | null
          date_extracted?: string | null
          flag_reason?: string | null
          id?: string
          match_confidence?: number | null
          match_status?: string
          notes?: string | null
          photo_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          statement_period_id?: string | null
          status?: string
          storage_path?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id: string
          vendor_confirmed?: string | null
          vendor_extracted?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_raw_text?: string | null
          amount_confirmed?: number | null
          amount_extracted?: number | null
          category_id?: string | null
          created_at?: string
          date_confirmed?: string | null
          date_extracted?: string | null
          flag_reason?: string | null
          id?: string
          match_confidence?: number | null
          match_status?: string
          notes?: string | null
          photo_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          statement_period_id?: string | null
          status?: string
          storage_path?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
          vendor_confirmed?: string | null
          vendor_extracted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_statement_period_id_fkey"
            columns: ["statement_period_id"]
            isOneToOne: false
            referencedRelation: "statement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      statement_periods: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_closed: boolean
          is_current: boolean
          name: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_closed?: boolean
          is_current?: boolean
          name: string
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_closed?: boolean
          is_current?: boolean
          name?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number | null
          card_last_four: string | null
          created_at: string
          id: string
          import_batch_id: string | null
          match_confidence: number | null
          match_status: string
          notes: string | null
          source: string
          statement_period_id: string | null
          transaction_date: string | null
          updated_at: string
          user_id: string | null
          vendor_normalized: string | null
          vendor_raw: string | null
        }
        Insert: {
          amount?: number | null
          card_last_four?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          match_confidence?: number | null
          match_status?: string
          notes?: string | null
          source?: string
          statement_period_id?: string | null
          transaction_date?: string | null
          updated_at?: string
          user_id?: string | null
          vendor_normalized?: string | null
          vendor_raw?: string | null
        }
        Update: {
          amount?: number | null
          card_last_four?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          match_confidence?: number | null
          match_status?: string
          notes?: string | null
          source?: string
          statement_period_id?: string | null
          transaction_date?: string | null
          updated_at?: string
          user_id?: string | null
          vendor_normalized?: string | null
          vendor_raw?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_statement_period_id_fkey"
            columns: ["statement_period_id"]
            isOneToOne: false
            referencedRelation: "statement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
