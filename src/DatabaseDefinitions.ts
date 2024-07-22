export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      contact_requests: {
        Row: {
          company_name: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          message_body: string | null
          phone: string | null
          updated_at: Date | null
        }
        Insert: {
          company_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          message_body?: string | null
          phone?: string | null
          updated_at?: Date | null
        }
        Update: {
          company_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          message_body?: string | null
          phone?: string | null
          updated_at?: Date | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          gender: string | null
          date_of_birth: string | null
          location: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          gender?: string | null
          date_of_birth?: string | null
          location?: string | null
          id: string
          updated_at?: Date | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          gender?: string | null
          date_of_birth?: string | null
          location?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          stripe_customer_id: string
          updated_at: Date | null
          user_id: string
        }
        Insert: {
          stripe_customer_id: string
          updated_at?: Date | null
          user_id: string
        }
        Update: {
          stripe_customer_id?: string
          updated_at?: Date | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          id: string
          email: string
          token: string
          invited_by: string
          accepted: boolean
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          token: string
          invited_by: string
          accepted?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          token?: string
          invited_by?: string
          accepted?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      },
      meditation_sessions: {
        Row: {
          id: string,
          user_id: string,
          duration: number,
          method: string | null,
          comments: string | null,
          start_ts: Date,
          end_ts: Date | null
        },
        Insert: {
          id?: string,
          user_id: string,
          duration: number,
          method?: string | null,
          comments?: string | null,
          start_ts?: Date,
          end_ts?: Date | null
        },
        Update: {
          id?: string,
          user_id?: string,
          duration?: number,
          method?: string | null,
          comments?: string | null,
          start_ts?: Date,
          end_ts?: Date | null
        },
        Relationships: [
          {
            foreignKeyName: "meditation_sessions_user_id_fkey",
            columns: ["user_id"],
            referencedRelation: "auth.users",
            referencedColumns: ["id"]
          }
        ]
      },
      biometrics: {
        Row: {
          ts: string // TIMESTAMPTZ is represented as string in TypeScript
          meditation_id: number
          bpm: number | null
          brpm: number | null
          movement: number | null
          elapsed_seconds: number | null
        }
        Insert: {
          ts: string
          meditation_id: number
          bpm?: number | null
          brpm?: number | null
          movement?: number | null
          elapsed_seconds?: number | null
        }
        Update: {
          ts?: string
          meditation_id?: number
          bpm?: number | null
          brpm?: number | null
          movement?: number | null
          elapsed_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "biometrics_meditation_id_fkey"
            columns: ["meditation_id"]
            referencedRelation: "meditation_sessions"
            referencedColumns: ["id"]
          }
        ]
      },
      meditation_instructions: {
        Row: {
          ts: string
          meditation_id: number
          instruction: string
        }
        Insert: {
          ts: string
          meditation_id: number
          instruction: string
        }
        Update: {
          ts?: string
          meditation_id?: number
          instruction?: string
        }
        Relationships: [
          {
            foreignKeyName: "meditation_instructions_meditation_id_fkey"
            columns: ["meditation_id"]
            referencedRelation: "meditation_sessions"
            referencedColumns: ["id"]
          }
        ]
      },          
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}