-- Supabase setup for Skornšek AI knowledge base
-- Run this in Supabase SQL Editor.

create extension if not exists vector;

create table if not exists documents (
  id bigserial primary key,
  source_id text,
  title text not null,
  source_group text,
  category text,
  url text,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz default now()
);

create index if not exists documents_embedding_idx
on documents
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

create index if not exists documents_source_id_idx on documents(source_id);
create index if not exists documents_category_idx on documents(category);

create or replace function match_documents (
  query_embedding vector(1536),
  match_count int default 8,
  match_threshold float default 0.20
)
returns table (
  id bigint,
  source_id text,
  title text,
  source_group text,
  category text,
  url text,
  chunk_index integer,
  content text,
  similarity float
)
language sql stable
as $$
  select
    documents.id,
    documents.source_id,
    documents.title,
    documents.source_group,
    documents.category,
    documents.url,
    documents.chunk_index,
    documents.content,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;
