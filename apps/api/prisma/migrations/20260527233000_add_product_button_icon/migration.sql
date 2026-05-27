ALTER TABLE "Product" ADD COLUMN "buttonIcon" TEXT NOT NULL DEFAULT '🛍️';

UPDATE "Product"
SET "buttonIcon" = CASE
  WHEN lower("name") LIKE '%chatgpt%' OR lower("name") LIKE '%openai%' OR lower("name") LIKE '%gpt%' THEN '🤖'
  WHEN lower("name") LIKE '%claude%' OR lower("name") LIKE '%anthropic%' THEN '🟫'
  WHEN lower("name") LIKE '%gemini%' THEN '✦'
  WHEN lower("name") LIKE '%adobe%' OR lower("name") LIKE '%photoshop%' OR lower("name") LIKE '%premiere%' OR lower("name") LIKE '%after effect%' OR lower("name") LIKE '%illustrator%' THEN '🅰️'
  WHEN lower("name") LIKE '%capcut%' THEN '🎬'
  WHEN lower("name") LIKE '%youtube%' OR lower("name") LIKE '%yt%' THEN '▶️'
  WHEN lower("name") LIKE '%canva%' THEN '🟣'
  WHEN lower("name") LIKE '%grok%' OR lower("name") LIKE '%twitter%' OR lower("name") LIKE '%x premium%' THEN '𝕏'
  WHEN lower("name") LIKE '%google%' OR lower("name") LIKE '%drive%' OR lower("name") LIKE '%gmail%' THEN '🌐'
  WHEN lower("name") LIKE '%microsoft%' OR lower("name") LIKE '%office%' OR lower("name") LIKE '%copilot%' OR lower("name") LIKE '%onedrive%' THEN '🪟'
  WHEN lower("name") LIKE '%cursor%' THEN '⌘'
  WHEN lower("name") LIKE '%midjourney%' THEN '🎨'
  WHEN lower("name") LIKE '%notion%' THEN '▣'
  WHEN lower("name") LIKE '%spotify%' THEN '🎧'
  WHEN lower("name") LIKE '%netflix%' THEN '🎞️'
  WHEN lower("name") LIKE '%api%' THEN '🔗'
  WHEN lower("name") LIKE '%ai%' THEN '🧠'
  ELSE "buttonIcon"
END;
