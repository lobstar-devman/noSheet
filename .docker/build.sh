#!/bin/bash

THIS_DIR="$(dirname "$0")"
cd "$(dirname "$0")"/..

### 
## Project specific build steps
###

set -e

# Install PHP dependencies
echo "📦 Installing Composer dependencies..."
composer install

# Create .env file if it doesn't exist
touch .env

echo "✅ Composer install completed successfully!"

echo "📦 Installing Node dependencies..."
npm install --ignore-scripts
npm audit fix
npm run build
echo "✅ Node dependencies installed successfully!"

php artisan migrate 

# Browser list
echo "🕸️ Update browser list"
npx --yes update-browserslist-db@latest

# Set up Heroku autocomplete if available
if [ -f "./heroku_autocomplete.sh" ]; then
    echo "🔧 Setting up Heroku autocomplete..."
    source ./heroku_autocomplete.sh
fi

#populate database using sql file
if [ -f "$REPO_ROOT/$IMPORT_DATABASE" ]; then 
    psql -a -f "$REPO_ROOT/$IMPORT_DATABASE"
fi

# Point image Apache document root to app document root
$THIS_DIR/apache.sh

echo "🎉 App is ready for development!"

