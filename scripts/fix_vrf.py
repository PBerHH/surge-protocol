import re

with open('crank.ts', 'r') as f:
    content = f.read()

old = '''function generateVrfSeed(): number[] {
  if (n == 0) { return 0 };
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }'''

# Find and replace the broken function
new_fn = '''function generateVrfSeed(): number[] {
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf);
}'''

# Replace from function start to first return Array.from
pattern = r'function generateVrfSeed\(\): number\[\] \{.*?(?=\n// ── |\nasync function)'
replacement = new_fn + '\n\n'
content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open('crank.ts', 'w') as f:
    f.write(content)

print("Done")
