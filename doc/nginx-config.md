# Nginx Configuration for UI Deployment

## Overview

This document describes the nginx configuration needed to serve the JSUI application files from `/ui/` with HTML files named `user` and `admin` (without extensions) served as HTML.

## Current Structure

- **Current path**: `/javascripts/jsui/`
- **Current files**: `index.html`, `admin.html`

## Proposed Structure

- **New path**: `/ui/`
- **New HTML files**: `user` (no extension, was `index.html`), `admin` (no extension, was `admin.html`)
- **JavaScript files**: Will be referenced from within the HTML files (e.g., `./app.js`, `./admin-app.js`)

## Nginx Configuration

```nginx
  # Handle other /ui/ files (CSS, JS, images, etc.) normally
  location ^~ /ui/ {
    alias /opt/rails/public/javascripts/jsui/;
    try_files $uri $uri/ =404;
  }

  # Serve /ui/user as HTML (replaces index.html)
  location = /ui/user {
    # root /opt/rails/public/javascripts/jsui;
    default_type text/html;
    alias /opt/rails/public/javascripts/jsui/index.html;
  }
  # Serve /ui/admin as HTML (replaces admin.html)
  location = /ui/admin {
    # root /opt/rails/public/javascripts/jsui;
    default_type text/html;
    alias /opt/rails/public/javascripts/jsui/admin.html;
  }

  location ^~ /javascripts {
    root /opt/rails/public;
    add_header Access-Control-Allow-Origin "*";
    add_header Access-Control-Allow-Credentials *;
    add_header Access-Control-Allow-Headers 'Authorization, Content-Type, X-Requested-With';
  }

```

## Testing

After updating nginx configuration:

1. Test the configuration: `nginx -t`
2. Reload nginx: `nginx -s reload` or `systemctl reload nginx`
3. Verify MIME type:
   ```bash
   curl -I https://dydra.com/ui/user
   # Should show: Content-Type: text/html; charset=utf-8
   
   curl -I https://dydra.com/ui/admin
   # Should show: Content-Type: text/html; charset=utf-8
   ```

## Notes

- The `Content-Type: text/html` header is critical - browsers need to know these are HTML documents
- The `charset=utf-8` ensures proper character encoding
- Make sure file permissions allow nginx to read the files
- JavaScript files referenced from within the HTML (e.g., `./app.js`, `./admin-app.js`) will be served with their default MIME type based on the `.js` extension
- The source HTML files remain named `index.html` and `admin.html` on disk — nginx aliases them to `/ui/user` and `/ui/admin`

## Application Configuration

The JSUI router is configured with `basePath: "/ui"` in `lib/config.js`. This ensures:

- All internal navigation links use the `/ui/` prefix
- The router correctly strips the base path when matching routes
- Cross-app links use `/ui/user` and `/ui/admin` (without `.html` extensions)
