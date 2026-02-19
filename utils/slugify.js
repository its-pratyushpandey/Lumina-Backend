export const slugify = (text) => {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
};

export const ensureUniqueSlug = async ({ model, baseSlug, slugField = 'slug' }) => {
  let slug = baseSlug;
  let suffix = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await model.exists({ [slugField]: slug });
    if (!exists) return slug;
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
};
