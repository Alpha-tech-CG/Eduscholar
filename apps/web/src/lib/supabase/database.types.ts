
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "academic_domains": {
                  Row: {
                    "code": string,"is_active": boolean,"labels": NonNullable<Json>
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"labels": NonNullable<Json>
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"academic_programs": {
                  Row: {
                    "code": string,"domain_code": string,"is_active": boolean,"labels": NonNullable<Json>
                  }
                  Insert: {
                    "code": string,"domain_code": string,"is_active"?: boolean,"labels": NonNullable<Json>
                  }
                  Update: {
                    "code"?: string,"domain_code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "academic_programs_domain_code_fkey"
      columns: ["domain_code"]
isOneToOne: false
      referencedRelation: "academic_domains"
      referencedColumns: ["code"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"category": string,"id": number,"metadata": NonNullable<Json>,"occurred_at": string,"organization_id": string | null,"subject_user_id": string | null,"target_id": string | null,"target_type": string | null
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"category": string,"id"?: never,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"organization_id"?: string | null,"subject_user_id"?: string | null,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"category"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"organization_id"?: string | null,"subject_user_id"?: string | null,"target_id"?: string | null,"target_type"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"countries": {
                  Row: {
                    "code": string,"is_active": boolean,"labels": NonNullable<Json>
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"labels": NonNullable<Json>
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"education_levels": {
                  Row: {
                    "code": string,"is_active": boolean,"isced_level": number | null,"labels": NonNullable<Json>,"position": number
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"isced_level"?: number | null,"labels": NonNullable<Json>,"position"?: number
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"isced_level"?: number | null,"labels"?: NonNullable<Json>,"position"?: number
                  }
                  Relationships: [
                    
                  ]
                },"languages": {
                  Row: {
                    "code": string,"is_active": boolean,"is_interface": boolean,"labels": NonNullable<Json>
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"is_interface"?: boolean,"labels": NonNullable<Json>
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"is_interface"?: boolean,"labels"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"organization_members": {
                  Row: {
                    "created_at": string,"invited_by": string | null,"organization_id": string,"role": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"invited_by"?: string | null,"organization_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"invited_by"?: string | null,"organization_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "country_code": string | null,"created_at": string,"created_by": string | null,"id": string,"name": string,"slug": string,"status": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"slug": string,"status"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"slug"?: string,"status"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"platform_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"role": string,"user_id": string
                  }
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"role": string,"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profile_public": {
                  Row: {
                    "display_name": string | null,"is_public": boolean,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "display_name"?: string | null,"is_public"?: boolean,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "display_name"?: string | null,"is_public"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_public_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "age_confirmed_at": string | null,"country_code": string | null,"created_at": string,"goals": (string)[],"institution_name": string | null,"level_code": string | null,"onboarded_at": string | null,"preferred_locale": string,"program_code": string | null,"specialty_code": string | null,"subject_codes": (string)[],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "age_confirmed_at"?: string | null,"country_code"?: string | null,"created_at"?: string,"goals"?: (string)[],"institution_name"?: string | null,"level_code"?: string | null,"onboarded_at"?: string | null,"preferred_locale"?: string,"program_code"?: string | null,"specialty_code"?: string | null,"subject_codes"?: (string)[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "age_confirmed_at"?: string | null,"country_code"?: string | null,"created_at"?: string,"goals"?: (string)[],"institution_name"?: string | null,"level_code"?: string | null,"onboarded_at"?: string | null,"preferred_locale"?: string,"program_code"?: string | null,"specialty_code"?: string | null,"subject_codes"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "profiles_level_code_fkey"
      columns: ["level_code"]
isOneToOne: false
      referencedRelation: "education_levels"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "profiles_program_code_fkey"
      columns: ["program_code"]
isOneToOne: false
      referencedRelation: "academic_programs"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "profiles_specialty_fkey"
      columns: ["program_code","specialty_code"]
isOneToOne: false
      referencedRelation: "program_specialties"
      referencedColumns: ["program_code","code"]
    }
                  ]
                },"program_specialties": {
                  Row: {
                    "code": string,"is_active": boolean,"labels": NonNullable<Json>,"position": number,"program_code": string
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"labels": NonNullable<Json>,"position"?: number,"program_code": string
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>,"position"?: number,"program_code"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_specialties_program_code_fkey"
      columns: ["program_code"]
isOneToOne: false
      referencedRelation: "academic_programs"
      referencedColumns: ["code"]
    }
                  ]
                },"subjects": {
                  Row: {
                    "code": string,"is_active": boolean,"labels": NonNullable<Json>,"position": number,"program_code": string
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"labels": NonNullable<Json>,"position"?: number,"program_code": string
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>,"position"?: number,"program_code"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subjects_program_code_fkey"
      columns: ["program_code"]
isOneToOne: false
      referencedRelation: "academic_programs"
      referencedColumns: ["code"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "account_deletion_check":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"consume_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"second_factor_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "has_verified_factor": boolean,"session_verified": boolean
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
