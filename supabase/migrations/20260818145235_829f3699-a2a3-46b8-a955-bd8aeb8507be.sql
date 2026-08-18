ALTER TABLE public.youtube_account ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- hapus baris lama tanpa channel_id (tidak bisa dipakai multi-channel)
DELETE FROM public.youtube_account WHERE channel_id IS NULL;

-- jadikan channel_id wajib & unik
UPDATE public.youtube_account SET id = channel_id WHERE channel_id IS NOT NULL;
ALTER TABLE public.youtube_account ALTER COLUMN channel_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'youtube_account_channel_id_key'
  ) THEN
    ALTER TABLE public.youtube_account ADD CONSTRAINT youtube_account_channel_id_key UNIQUE (channel_id);
  END IF;
END $$;