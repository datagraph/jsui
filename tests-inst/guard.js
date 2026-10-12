export async function __guard(locator, label, opts) {
  const v = await locator.isVisible(opts).catch(() => false);
  if (!v) console.log('VACUOUS ' + label);
  return v;
}
