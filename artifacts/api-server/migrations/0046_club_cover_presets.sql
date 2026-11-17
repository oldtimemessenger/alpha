ALTER TABLE clubs ADD COLUMN cover_preset_id TEXT CHECK (
  cover_preset_id IS NULL OR cover_preset_id IN (
    'marbled-red','minimal-mesh','misty-forest','urban-motion','fluid-fusion',
    'concert-crowd','creator-desk','faithful-rays','geometric-glass','warm-grid',
    'love-letters','love-together','sex-intimacy','faith-light','gods-grace',
    'quiet-prayer','tech-circuit','code-studio','basketball-court','courtside',
    'music-night','creator-studio'
  )
);
