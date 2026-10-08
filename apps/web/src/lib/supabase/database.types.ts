
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
                },"collection_items": {
                  Row: {
                    "added_at": string,"collection_id": string,"resource_id": string
                  }
                  Insert: {
                    "added_at"?: string,"collection_id": string,"resource_id": string
                  }
                  Update: {
                    "added_at"?: string,"collection_id"?: string,"resource_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "collection_items_collection_id_fkey"
      columns: ["collection_id"]
isOneToOne: false
      referencedRelation: "collections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "collection_items_resource_id_fkey"
      columns: ["resource_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id"]
    }
                  ]
                },"collections": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"name": string,"owner_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"owner_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string,"updated_at"?: string
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
                },"known_devices": {
                  Row: {
                    "device_hash": string,"first_seen_at": string,"last_seen_at": string,"user_id": string
                  }
                  Insert: {
                    "device_hash": string,"first_seen_at"?: string,"last_seen_at"?: string,"user_id": string
                  }
                  Update: {
                    "device_hash"?: string,"first_seen_at"?: string,"last_seen_at"?: string,"user_id"?: string
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
                },"licenses": {
                  Row: {
                    "allows_commercial_use": boolean,"can_host": string,"can_redistribute": string,"code": string,"is_active": boolean,"labels": NonNullable<Json>,"position": number,"requires_attribution": boolean
                  }
                  Insert: {
                    "allows_commercial_use"?: boolean,"can_host": string,"can_redistribute": string,"code": string,"is_active"?: boolean,"labels": NonNullable<Json>,"position"?: number,"requires_attribution"?: boolean
                  }
                  Update: {
                    "allows_commercial_use"?: boolean,"can_host"?: string,"can_redistribute"?: string,"code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>,"position"?: number,"requires_attribution"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"literature_notes": {
                  Row: {
                    "concepts": string | null,"limits": string | null,"method": string | null,"population_field": string | null,"problem": string | null,"project_link": string | null,"quote_pages": string | null,"results": string | null,"source_id": string,"target_chapter": string | null,"updated_at": string,"useful_quote": string | null
                  }
                  Insert: {
                    "concepts"?: string | null,"limits"?: string | null,"method"?: string | null,"population_field"?: string | null,"problem"?: string | null,"project_link"?: string | null,"quote_pages"?: string | null,"results"?: string | null,"source_id": string,"target_chapter"?: string | null,"updated_at"?: string,"useful_quote"?: string | null
                  }
                  Update: {
                    "concepts"?: string | null,"limits"?: string | null,"method"?: string | null,"population_field"?: string | null,"problem"?: string | null,"project_link"?: string | null,"quote_pages"?: string | null,"results"?: string | null,"source_id"?: string,"target_chapter"?: string | null,"updated_at"?: string,"useful_quote"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "literature_notes_source_id_fkey"
      columns: ["source_id"]
isOneToOne: true
      referencedRelation: "project_sources"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "email_digest": boolean,"last_emailed_at": string | null,"unsubscribe_token": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "email_digest"?: boolean,"last_emailed_at"?: string | null,"unsubscribe_token": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "email_digest"?: boolean,"last_emailed_at"?: string | null,"unsubscribe_token"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"id": string,"kind": string,"project_id": string,"read_at": string | null,"section_id": string | null,"user_id": string,"version_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": string,"project_id": string,"read_at"?: string | null,"section_id"?: string | null,"user_id": string,"version_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"project_id"?: string,"read_at"?: string | null,"section_id"?: string | null,"user_id"?: string,"version_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "created_at": string,"invited_by": string | null,"organization_id": string,"role": string,"role_granted_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"invited_by"?: string | null,"organization_id": string,"role"?: string,"role_granted_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"invited_by"?: string | null,"organization_id"?: string,"role"?: string,"role_granted_at"?: string,"user_id"?: string
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
                },"project_access_requests": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"id": string,"project_id": string,"role": string,"status": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"id"?: string,"project_id": string,"role": string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"id"?: string,"project_id"?: string,"role"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_access_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_comments": {
                  Row: {
                    "author_id": string | null,"body": string | null,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"parent_id": string | null,"project_id": string,"quote": string | null,"resolved_at": string | null,"resolved_by": string | null,"section_id": string
                  }
                  Insert: {
                    "author_id"?: string | null,"body"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"parent_id"?: string | null,"project_id": string,"quote"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"section_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"parent_id"?: string | null,"project_id"?: string,"quote"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"section_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_comments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "project_comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_comments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_comments_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "thesis_sections"
      referencedColumns: ["id"]
    }
                  ]
                },"project_invitations": {
                  Row: {
                    "accepted_by": string | null,"created_at": string,"created_by": string | null,"email": string,"expires_at": string,"full_access": boolean,"id": string,"project_id": string,"role": string,"section_ids": (string)[] | null,"status": string,"token_hash": string
                  }
                  Insert: {
                    "accepted_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"email": string,"expires_at": string,"full_access"?: boolean,"id"?: string,"project_id": string,"role": string,"section_ids"?: (string)[] | null,"status"?: string,"token_hash": string
                  }
                  Update: {
                    "accepted_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string,"expires_at"?: string,"full_access"?: boolean,"id"?: string,"project_id"?: string,"role"?: string,"section_ids"?: (string)[] | null,"status"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_invitations_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_share_links": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"project_id": string,"revoked_at": string | null,"role": string,"token_hash": string
                  }
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"project_id": string,"revoked_at"?: string | null,"role": string,"token_hash": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"project_id"?: string,"revoked_at"?: string | null,"role"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_share_links_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_sources": {
                  Row: {
                    "accessed_on": string | null,"authors": (string)[],"container_title": string | null,"created_at": string,"doi": string | null,"id": string,"issue": string | null,"pages": string | null,"project_id": string,"publication_year": number | null,"publisher": string | null,"resource_id": string | null,"source_type": string,"title": string,"updated_at": string,"url": string | null,"volume": string | null
                  }
                  Insert: {
                    "accessed_on"?: string | null,"authors"?: (string)[],"container_title"?: string | null,"created_at"?: string,"doi"?: string | null,"id"?: string,"issue"?: string | null,"pages"?: string | null,"project_id": string,"publication_year"?: number | null,"publisher"?: string | null,"resource_id"?: string | null,"source_type"?: string,"title": string,"updated_at"?: string,"url"?: string | null,"volume"?: string | null
                  }
                  Update: {
                    "accessed_on"?: string | null,"authors"?: (string)[],"container_title"?: string | null,"created_at"?: string,"doi"?: string | null,"id"?: string,"issue"?: string | null,"pages"?: string | null,"project_id"?: string,"publication_year"?: number | null,"publisher"?: string | null,"resource_id"?: string | null,"source_type"?: string,"title"?: string,"updated_at"?: string,"url"?: string | null,"volume"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_sources_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_sources_resource_id_fkey"
      columns: ["resource_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id"]
    }
                  ]
                },"project_tasks": {
                  Row: {
                    "created_at": string,"created_by": string | null,"details": string | null,"done_at": string | null,"done_by": string | null,"due_date": string | null,"id": string,"project_id": string,"reminded_for": string | null,"title": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"details"?: string | null,"done_at"?: string | null,"done_by"?: string | null,"due_date"?: string | null,"id"?: string,"project_id": string,"reminded_for"?: string | null,"title": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"details"?: string | null,"done_at"?: string | null,"done_by"?: string | null,"due_date"?: string | null,"id"?: string,"project_id"?: string,"reminded_for"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"research_project_member_sections": {
                  Row: {
                    "project_id": string,"section_id": string,"user_id": string
                  }
                  Insert: {
                    "project_id": string,"section_id": string,"user_id": string
                  }
                  Update: {
                    "project_id"?: string,"section_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_project_member_sections_project_id_user_id_fkey"
      columns: ["project_id","user_id"]
isOneToOne: false
      referencedRelation: "research_project_members"
      referencedColumns: ["project_id","user_id"]
    },{
      foreignKeyName: "research_project_member_sections_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "thesis_sections"
      referencedColumns: ["id"]
    }
                  ]
                },"research_project_members": {
                  Row: {
                    "created_at": string,"full_access": boolean,"invited_by": string | null,"project_id": string,"role": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"full_access"?: boolean,"invited_by"?: string | null,"project_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"full_access"?: boolean,"invited_by"?: string | null,"project_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_project_members_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"research_projects": {
                  Row: {
                    "context": string | null,"created_at": string,"deleted_at": string | null,"due_date": string | null,"fieldwork": string | null,"general_objective": string | null,"hypotheses": (string)[],"id": string,"main_question": string | null,"methodology": string | null,"outline": string | null,"owner_id": string,"population_sample": string | null,"problem_statement": string | null,"program_code": string | null,"secondary_questions": (string)[],"specific_objectives": (string)[],"status": string,"supervisor_name": string | null,"theoretical_framework": string | null,"title": string,"updated_at": string
                  }
                  Insert: {
                    "context"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"fieldwork"?: string | null,"general_objective"?: string | null,"hypotheses"?: (string)[],"id"?: string,"main_question"?: string | null,"methodology"?: string | null,"outline"?: string | null,"owner_id": string,"population_sample"?: string | null,"problem_statement"?: string | null,"program_code"?: string | null,"secondary_questions"?: (string)[],"specific_objectives"?: (string)[],"status"?: string,"supervisor_name"?: string | null,"theoretical_framework"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "context"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"due_date"?: string | null,"fieldwork"?: string | null,"general_objective"?: string | null,"hypotheses"?: (string)[],"id"?: string,"main_question"?: string | null,"methodology"?: string | null,"outline"?: string | null,"owner_id"?: string,"population_sample"?: string | null,"problem_statement"?: string | null,"program_code"?: string | null,"secondary_questions"?: (string)[],"specific_objectives"?: (string)[],"status"?: string,"supervisor_name"?: string | null,"theoretical_framework"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_projects_program_code_fkey"
      columns: ["program_code"]
isOneToOne: false
      referencedRelation: "academic_programs"
      referencedColumns: ["code"]
    }
                  ]
                },"resource_favorites": {
                  Row: {
                    "created_at": string,"resource_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"resource_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"resource_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_favorites_resource_id_fkey"
      columns: ["resource_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id"]
    }
                  ]
                },"resource_internal": {
                  Row: {
                    "contributor_comment": string | null,"moderation_notes": string | null,"permission_proof": string | null,"resource_id": string,"rights_declared_at": string | null
                  }
                  Insert: {
                    "contributor_comment"?: string | null,"moderation_notes"?: string | null,"permission_proof"?: string | null,"resource_id": string,"rights_declared_at"?: string | null
                  }
                  Update: {
                    "contributor_comment"?: string | null,"moderation_notes"?: string | null,"permission_proof"?: string | null,"resource_id"?: string,"rights_declared_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_internal_resource_id_fkey"
      columns: ["resource_id"]
isOneToOne: true
      referencedRelation: "resources"
      referencedColumns: ["id"]
    }
                  ]
                },"resource_reports": {
                  Row: {
                    "created_at": string,"details": string | null,"handled_at": string | null,"handled_by": string | null,"id": string,"reason": string,"reporter_id": string | null,"resolution_note": string | null,"resource_id": string,"status": string
                  }
                  Insert: {
                    "created_at"?: string,"details"?: string | null,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: string,"reason": string,"reporter_id"?: string | null,"resolution_note"?: string | null,"resource_id": string,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"details"?: string | null,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: string,"reason"?: string,"reporter_id"?: string | null,"resolution_note"?: string | null,"resource_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_reports_resource_id_fkey"
      columns: ["resource_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id"]
    }
                  ]
                },"resource_status_history": {
                  Row: {
                    "action": string,"actor_id": string | null,"from_status": string | null,"id": number,"occurred_at": string,"reason": string | null,"resource_id": string,"to_status": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"from_status"?: string | null,"id"?: never,"occurred_at"?: string,"reason"?: string | null,"resource_id": string,"to_status": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"from_status"?: string | null,"id"?: never,"occurred_at"?: string,"reason"?: string | null,"resource_id"?: string,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resource_status_history_resource_id_fkey"
      columns: ["resource_id"]
isOneToOne: false
      referencedRelation: "resources"
      referencedColumns: ["id"]
    }
                  ]
                },"resource_types": {
                  Row: {
                    "code": string,"is_active": boolean,"labels": NonNullable<Json>,"position": number
                  }
                  Insert: {
                    "code": string,"is_active"?: boolean,"labels": NonNullable<Json>,"position"?: number
                  }
                  Update: {
                    "code"?: string,"is_active"?: boolean,"labels"?: NonNullable<Json>,"position"?: number
                  }
                  Relationships: [
                    
                  ]
                },"resources": {
                  Row: {
                    "abstract": string | null,"access_status": string,"authors": (string)[],"country_code": string | null,"created_at": string,"doi": string | null,"edited_fields": (string)[],"editorial_status": string,"id": string,"institution_name": string | null,"language_code": string,"last_verified_at": string | null,"level_codes": (string)[],"license_code": string,"official_url": string | null,"organization_id": string | null,"program_code": string,"publication_year": number | null,"published_at": string | null,"retrieved_at": string | null,"search_vector": unknown,"source_identifier": string | null,"source_kind": string,"source_name": string,"subject_codes": (string)[],"submitted_by": string | null,"tags": (string)[],"thesis_degree": string | null,"title": string,"type_code": string,"updated_at": string,"visibility": string
                  }
                  Insert: {
                    "abstract"?: string | null,"access_status"?: string,"authors"?: (string)[],"country_code"?: string | null,"created_at"?: string,"doi"?: string | null,"edited_fields"?: (string)[],"editorial_status"?: string,"id"?: string,"institution_name"?: string | null,"language_code": string,"last_verified_at"?: string | null,"level_codes"?: (string)[],"license_code"?: string,"official_url"?: string | null,"organization_id"?: string | null,"program_code": string,"publication_year"?: number | null,"published_at"?: string | null,"retrieved_at"?: string | null,"search_vector"?: unknown,"source_identifier"?: string | null,"source_kind": string,"source_name": string,"subject_codes"?: (string)[],"submitted_by"?: string | null,"tags"?: (string)[],"thesis_degree"?: string | null,"title": string,"type_code": string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "abstract"?: string | null,"access_status"?: string,"authors"?: (string)[],"country_code"?: string | null,"created_at"?: string,"doi"?: string | null,"edited_fields"?: (string)[],"editorial_status"?: string,"id"?: string,"institution_name"?: string | null,"language_code"?: string,"last_verified_at"?: string | null,"level_codes"?: (string)[],"license_code"?: string,"official_url"?: string | null,"organization_id"?: string | null,"program_code"?: string,"publication_year"?: number | null,"published_at"?: string | null,"retrieved_at"?: string | null,"search_vector"?: unknown,"source_identifier"?: string | null,"source_kind"?: string,"source_name"?: string,"subject_codes"?: (string)[],"submitted_by"?: string | null,"tags"?: (string)[],"thesis_degree"?: string | null,"title"?: string,"type_code"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "resources_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "resources_language_code_fkey"
      columns: ["language_code"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "resources_license_code_fkey"
      columns: ["license_code"]
isOneToOne: false
      referencedRelation: "licenses"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "resources_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resources_program_code_fkey"
      columns: ["program_code"]
isOneToOne: false
      referencedRelation: "academic_programs"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "resources_type_code_fkey"
      columns: ["type_code"]
isOneToOne: false
      referencedRelation: "resource_types"
      referencedColumns: ["code"]
    }
                  ]
                },"section_citations": {
                  Row: {
                    "created_at": string,"pages": string | null,"section_id": string,"source_id": string
                  }
                  Insert: {
                    "created_at"?: string,"pages"?: string | null,"section_id": string,"source_id": string
                  }
                  Update: {
                    "created_at"?: string,"pages"?: string | null,"section_id"?: string,"source_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "section_citations_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "thesis_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "section_citations_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "project_sources"
      referencedColumns: ["id"]
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
                },"thesis_sections": {
                  Row: {
                    "body": string | null,"created_at": string,"id": string,"level": number,"position": number,"project_id": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"id"?: string,"level"?: number,"position": number,"project_id": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"id"?: string,"level"?: number,"position"?: number,"project_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "thesis_sections_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"thesis_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"erased_at": string | null,"id": string,"label": string | null,"note": string | null,"number": number,"project_id": string,"section_count": number,"size_bytes": number,"snapshot": NonNullable<Json>,"word_count": number
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"erased_at"?: string | null,"id"?: string,"label"?: string | null,"note"?: string | null,"number": number,"project_id": string,"section_count"?: number,"size_bytes"?: number,"snapshot": NonNullable<Json>,"word_count"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"erased_at"?: string | null,"id"?: string,"label"?: string | null,"note"?: string | null,"number"?: number,"project_id"?: string,"section_count"?: number,"size_bytes"?: number,"snapshot"?: NonNullable<Json>,"word_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "thesis_versions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    }
                  ]
                },"version_decisions": {
                  Row: {
                    "comment": string | null,"decided_at": string,"decided_by": string | null,"decision": string,"id": string,"project_id": string,"version_id": string
                  }
                  Insert: {
                    "comment"?: string | null,"decided_at"?: string,"decided_by"?: string | null,"decision": string,"id"?: string,"project_id": string,"version_id": string
                  }
                  Update: {
                    "comment"?: string | null,"decided_at"?: string,"decided_by"?: string | null,"decision"?: string,"id"?: string,"project_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_decisions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "research_projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "version_decisions_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "thesis_versions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_project_invitation":
{ Args: { "token": string }; Returns: string
                           },
"account_deletion_check":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"add_project_comment":
{ Args: { "payload": Json,"section_id": string }; Returns: string
                           },
"add_project_source":
{ Args: { "payload": Json,"project_id": string }; Returns: string
                           },
"add_project_source_from_resource":
{ Args: { "project_id": string,"resource_id": string }; Returns: string
                           },
"add_project_task":
{ Args: { "payload": Json,"project_id": string }; Returns: string
                           },
"add_thesis_section":
{ Args: { "payload": Json,"project_id": string }; Returns: string
                           },
"admin_account_history":
{ Args: { "target_user": string }; Returns: {
              "changed_at": string,"changed_by_email": string,"reason": string,"status": string
            }[]
                           },
"admin_auth_events":
{ Args: Record<PropertyKey, never>; Returns: {
              "day": string,"kind": string,"total": number
            }[]
                           },
"admin_find_user":
{ Args: { "email": string }; Returns: {
              "confirmed": boolean,"created_at": string,"email": string,"has_second_factor": boolean,"roles": (string)[],"suspended": boolean,"suspension_reason": string,"user_id": string
            }[]
                           },
"admin_list_accounts":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"roles": (string)[],"suspended": boolean,"suspension_reason": string,"user_id": string
            }[]
                           },
"admin_session":
{ Args: Record<PropertyKey, never>; Returns: {
              "recent": boolean,"role_rank": number
            }[]
                           },
"admin_set_account_status":
{ Args: { "reason"?: string,"suspended": boolean,"target_user": string }; Returns: Json
                           },
"admin_set_role":
{ Args: { "grant_role": boolean,"role": string,"target_user": string }; Returns: Json
                           },
"claim_notification_digests":
{ Args: { "p_limit": number }; Returns: {
              "email": string,"unsubscribe_token": string
            }[]
                           },
"connector_gate":
{ Args: { "p_daily_limit": number,"p_source": string }; Returns: string
                           },
"connector_pause":
{ Args: { "p_seconds": number,"p_source": string }; Returns: undefined
                           },
"consume_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"create_collection":
{ Args: { "description"?: string,"name": string }; Returns: string
                           },
"create_project":
{ Args: { "payload": Json }; Returns: string
                           },
"create_project_link":
{ Args: { "payload": Json,"project_id": string }; Returns: string
                           },
"decide_access_request":
{ Args: { "approve": boolean,"request_id": string }; Returns: undefined
                           },
"decide_thesis_version":
{ Args: { "payload": Json,"version_id": string }; Returns: undefined
                           },
"delete_collection":
{ Args: { "collection_id": string }; Returns: undefined
                           },
"delete_project":
{ Args: { "project_id": string }; Returns: undefined
                           },
"delete_project_comment":
{ Args: { "comment_id": string }; Returns: undefined
                           },
"delete_project_source":
{ Args: { "source_id": string }; Returns: undefined
                           },
"delete_project_task":
{ Args: { "task_id": string }; Returns: undefined
                           },
"delete_thesis_section":
{ Args: { "section_id": string }; Returns: undefined
                           },
"discard_recovery_codes":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"erase_thesis_version":
{ Args: { "version_id": string }; Returns: undefined
                           },
"generate_recovery_codes":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"import_connector_resource":
{ Args: { "actor_id": string,"payload": Json }; Returns: Json
                           },
"invitation_preview":
{ Args: { "token": string }; Returns: Json
                           },
"invite_project_member":
{ Args: { "payload": Json,"project_id": string }; Returns: string
                           },
"last_recovery_code_use":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"leave_project":
{ Args: { "project_id": string }; Returns: undefined
                           },
"log_admin_refusal":
{ Args: { "code": string,"operation": string }; Returns: undefined
                           },
"log_personal_data_export":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"mark_notifications_read":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"moderate_resource":
{ Args: { "action": string,"reason"?: string,"resource_id": string }; Returns: string
                           },
"moderator_update_resource":
{ Args: { "payload": Json,"resource_id": string }; Returns: string
                           },
"move_thesis_section":
{ Args: { "direction": string,"section_id": string }; Returns: undefined
                           },
"must_keep_second_factor":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"my_account_events":
{ Args: Record<PropertyKey, never>; Returns: {
              "action": string,"category": string,"occurred_at": string
            }[]
                           },
"my_deleted_projects":
{ Args: Record<PropertyKey, never>; Returns: Json[]
                           },
"my_known_devices":
{ Args: Record<PropertyKey, never>; Returns: {
              "first_seen_at": string,"last_seen_at": string
            }[]
                           },
"my_notification_preferences":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"my_notifications":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"id": string,"is_read": boolean,"kind": string,"project_id": string,"project_title": string,"scope": string,"section_id": string,"version_id": string
            }[]
                           },
"my_pending_access_requests":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_project_comments":
{ Args: Record<PropertyKey, never>; Returns: {
              "body": string,"created_at": string,"id": string,"project_id": string,"quote": string,"section_id": string
            }[]
                           },
"my_project_tasks":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"details": string,"done_at": string,"due_date": string,"id": string,"project_id": string,"title": string
            }[]
                           },
"my_report_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_submission_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_thesis_versions":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"erased_at": string,"id": string,"label": string,"note": string,"number": number,"project_id": string,"section_count": number,"word_count": number
            }[]
                           },
"my_unread_notification_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_version_decisions":
{ Args: Record<PropertyKey, never>; Returns: {
              "comment": string,"decided_at": string,"decision": string,"project_id": string,"version_id": string
            }[]
                           },
"project_comments":
{ Args: { "project_id": string }; Returns: Json
                           },
"project_sharing":
{ Args: { "project_id": string }; Returns: Json
                           },
"project_tasks":
{ Args: { "project_id": string }; Returns: Json
                           },
"project_version":
{ Args: { "version_id": string }; Returns: Json
                           },
"project_versions":
{ Args: { "project_id": string }; Returns: Json
                           },
"purge_deleted_projects":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"record_auth_event":
{ Args: { "p_kind": string }; Returns: undefined
                           },
"recovery_codes_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "generated_at": string,"remaining": number
            }[]
                           },
"redeem_recovery_code":
{ Args: { "code": string }; Returns: boolean
                           },
"reference_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"register_sign_in_device":
{ Args: { "p_device_hash": string,"p_user_id": string }; Returns: boolean
                           },
"remove_project_member":
{ Args: { "project_id": string,"user_id": string }; Returns: undefined
                           },
"report_resource":
{ Args: { "details"?: string,"reason": string,"resource_id": string }; Returns: string
                           },
"request_project_access":
{ Args: { "token": string }; Returns: undefined
                           },
"resolve_project_thread":
{ Args: { "comment_id": string,"resolved": boolean }; Returns: undefined
                           },
"resolve_report":
{ Args: { "note"?: string,"report_id": string,"status": string }; Returns: undefined
                           },
"revoke_project_invitation":
{ Args: { "invitation_id": string }; Returns: undefined
                           },
"revoke_project_link":
{ Args: { "project_id": string }; Returns: undefined
                           },
"save_literature_note":
{ Args: { "payload": Json,"source_id": string }; Returns: undefined
                           },
"search_resources":
{ Args: { "payload": Json }; Returns: {
              "capped": boolean,"id": string,"total": number
            }[]
                           },
"second_factor_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "has_verified_factor": boolean,"session_verified": boolean
            }[]
                           },
"second_factor_wait_seconds":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"set_collection_item":
{ Args: { "collection_id": string,"present": boolean,"resource_id": string }; Returns: undefined
                           },
"set_favorite":
{ Args: { "favorite": boolean,"resource_id": string }; Returns: undefined
                           },
"set_member_scope":
{ Args: { "payload": Json,"project_id": string,"user_id": string }; Returns: undefined
                           },
"set_notification_preferences":
{ Args: { "payload": Json }; Returns: undefined
                           },
"set_section_citation":
{ Args: { "pages"?: string,"present": boolean,"section_id": string,"source_id": string }; Returns: undefined
                           },
"shared_project_document":
{ Args: { "project_id": string }; Returns: Json
                           },
"shared_projects":
{ Args: Record<PropertyKey, never>; Returns: {
              "due_date": string,"id": string,"owner_email": string,"role": string,"status": string,"title": string,"updated_at": string
            }[]
                           },
"submit_resource":
{ Args: { "payload": Json }; Returns: string
                           },
"submit_thesis_version":
{ Args: { "payload": Json,"project_id": string }; Returns: string
                           },
"unsubscribe_notifications":
{ Args: { "p_token": string }; Returns: undefined
                           },
"update_collection":
{ Args: { "collection_id": string,"description"?: string,"name": string }; Returns: undefined
                           },
"update_project":
{ Args: { "payload": Json,"project_id": string }; Returns: undefined
                           },
"update_project_comment":
{ Args: { "comment_id": string,"payload": Json }; Returns: undefined
                           },
"update_project_source":
{ Args: { "payload": Json,"source_id": string }; Returns: undefined
                           },
"update_project_task":
{ Args: { "payload": Json,"task_id": string }; Returns: undefined
                           },
"update_submission":
{ Args: { "payload": Json,"resource_id": string }; Returns: undefined
                           },
"update_thesis_section":
{ Args: { "payload": Json,"section_id": string }; Returns: string
                           },
"withdraw_submission":
{ Args: { "resource_id": string }; Returns: undefined
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
