import zipfile
import os
from pathlib import Path
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_DIR = r"C:\Users\aromi\OneDrive\Desktop\quest-academy"
OUTPUT_ZIP  = r"C:\Users\aromi\OneDrive\Desktop\quest-academy-snapshot.zip"
# ─────────────────────────────────────────────────────────────────────────────

# Move into the project directory so git archive works
os.chdir(PROJECT_DIR)

# Create archive from git (respects .gitignore, excludes node_modules etc.)
print("Creating git archive...")
os.system(f'git archive --format=zip -o temp.zip HEAD')

if not os.path.exists('temp.zip'):
    print("ERROR: git archive failed. Make sure you're in a git repo and git is installed.")
    exit(1)

# Flatten it — all files go to root, no nested folders
print("Flattening structure...")
with zipfile.ZipFile('temp.zip', 'r') as zip_in:
    with zipfile.ZipFile(OUTPUT_ZIP, 'w') as zip_out:
        seen = defaultdict(int)

        for item in zip_in.infolist():
            # Skip folders
            if item.filename.endswith('/'):
                continue

            filename = os.path.basename(item.filename)
            if not filename:
                continue

            # Handle duplicates: file.py → file_1.py, file_2.py, etc.
            if filename in seen:
                seen[filename] += 1
                name, ext = os.path.splitext(filename)
                new_filename = f"{name}_{seen[filename]}{ext}"
                print(f"  Duplicate renamed: {filename} → {new_filename}")
            else:
                seen[filename] = 0
                new_filename = filename

            data = zip_in.read(item.filename)
            zip_out.writestr(new_filename, data)

# Clean up temp file
os.remove('temp.zip')

print(f"\n✓ Created: {OUTPUT_ZIP}")
print(f"✓ Total files: {len(seen)}")
print(f"✓ node_modules and .gitignore'd files excluded")