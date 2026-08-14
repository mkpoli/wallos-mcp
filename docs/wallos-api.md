# Wallos HTTP API — v5.2.0 contract

Extracted from the endpoint sources of ellite/Wallos at tag v5.2.0.
Base path is `<instance>/api/`. Reads take `api_key` in `$_REQUEST`, so GET query or
POST form both work; writes read `$_POST` only, which in PHP means the body must be
`application/x-www-form-urlencoded` or `multipart/form-data` — a JSON body arrives empty.
Both `api_key` and `apiKey` are accepted everywhere.

## `api/admin/get_admin_settings.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user (must be user ID 1 / admin).

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- admin_settings: an object containing the admin settings.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "admin_settings",
  "admin_settings": {
    "registrations_open": 1,
    "max_users": 100,
    "require_email_verification": 1,
    "server_url": "http://example.com",
    "smtp_address": "smtp.example.com",
    "smtp_port": 587,
    "smtp_username": "admin@example.com",
    "smtp_password": "********",
    "from_email": "no-reply@example.com",
    "encryption": "tls",
    "login_disabled": 0,
    "latest_version": "v1.0.0",
    "update_notification": 1,
    "oidc_oauth_enabled": 0,
    "local_webhook_notifications_allowlist": "localhost,127.0.0.1"
  },
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/admin/get_oidc_settings.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- oidc_settings: an object containing the OIDC settings.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "oidc_settings",
  "oidc_settings": {
    "name": "Authentik",
    "client_id": "CJMLcyyS94cUMXkitNZuokayArnn23TXxpeUv48E",
    "client_secret": "SzfQBIibfN0gEAgCORrKnGnrYe9yqASWAYUuu1byelVosCHlnoqAdWlMDppblyuByb38Zw78AAlgMmdK6SWpGjOU4IiqaoltkAEh52trcqCB8briP1TqqXZdar4xfhVw",
    "authorization_url": "https://auth.bellamylab.com/application/o/authorize/",
    "token_url": "https://auth.bellamylab.com/application/o/token/",
    "user_info_url": "https://auth.bellamylab.com/application/o/userinfo/",
    "redirect_url": "http://localhost:80/wallos",
    "logout_url": "https://auth.bellamylab.com/application/o/wallos/end-session/",
    "user_identifier_field": "sub",
    "scopes": "openid email profile",
    "auth_style": "auto",
    "created_at": "2025-07-20 20:31:50",
    "updated_at": "2025-07-20 20:31:50",
    "auto_create_user": 0,
    "password_login_disabled": 0
  },
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/admin/set_admin_settings.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user (must be user ID 1 / admin).
- registrations_open: (optional) '1' or '0' (allow new signups).
- max_users: (optional) maximum allowed users (integer).
- require_email_verification: (optional) '1' or '0'.
- server_url: (optional) url of this wallos instance.
- smtp_address: (optional) SMTP server address.
- smtp_port: (optional) SMTP port (integer).
- smtp_username: (optional) SMTP login username.
- smtp_password: (optional) SMTP login password.
- from_email: (optional) outgoing email address.
- encryption: (optional) 'tls' or 'ssl'.
- login_disabled: (optional) '1' or '0' (disable standard login).
- update_notification: (optional) '1' or '0' (check for wallos updates).
- oidc_oauth_enabled: (optional) '1' or '0' (enable OIDC login).
- local_webhook_notifications_allowlist: (optional) comma-separated IP/hosts allowlist.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).

Example response:
{
  "success": true,
  "title": "Admin settings saved",
  "message": "Global admin settings have been updated successfully."
}
```

**Reads:** $_POST[$postKey] $_POST['apiKey'] $_POST['api_key'] $_POST['login_disabled'] $_POST['registrations_open'] $_POST['require_email_verification'] $_POST['server_url'] $_POST['smtp_address'] $_POST['smtp_port']

## `api/admin/set_disable_password_login.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user.
- disable: '1' to disable password login, '0' to enable it.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).

Example response:
{
  "success": true,
  "title": "Updated",
  "message": "Password login has been disabled."
}
```

**Reads:** $_POST['api_key'] $_POST['disable']

## `api/admin/set_oidc_settings.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user (must be user ID 1 / admin).
- oidc_enabled: (optional) '1' to enable OIDC logins, '0' to disable.
- name: (optional) provider name.
- client_id: (optional) OAuth client ID.
- client_secret: (optional) OAuth client secret.
- authorization_url: (optional) authorization endpoint.
- token_url: (optional) token endpoint.
- user_info_url: (optional) userinfo endpoint.
- redirect_url: (optional) callback/redirect URL.
- logout_url: (optional) logout/end-session URL.
- user_identifier_field: (optional) field identifier (e.g. sub).
- scopes: (optional) scope list.
- auth_style: (optional) authentication style (auto/header/params).
- auto_create_user: (optional) '1' to auto-register new OIDC users, '0' otherwise.
- password_login_disabled: (optional) '1' to disable password logins, '0' otherwise.
- require_email_verified: (optional) '1' to reject unverified emails, '0' otherwise.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).

Example response:
{
  "success": true,
  "title": "OIDC settings saved",
  "message": "OIDC configurations have been saved successfully."
}
```

**Reads:** $_POST['apiKey'] $_POST['api_key'] $_POST['auth_style'] $_POST['authorization_url'] $_POST['auto_create_user'] $_POST['client_id'] $_POST['client_secret'] $_POST['logout_url'] $_POST['name'] $_POST['oidc_enabled'] $_POST['password_login_disabled'] $_POST['redirect_url'] $_POST['require_email_verified'] $_POST['scopes'] $_POST['token_url'] $_POST['user_identifier_field'] $_POST['user_info_url']

## `api/categories/get_categories.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- categories: an array of categories.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "categories",
  "categories": [
    {
      "id": 1,
      "name": "General",
      "order": 1,
      "in_use": true
    },
    {
      "id": 2,
      "name": "Entertainment",
      "order": 2,
      "in_use": true
    },
    {
      "id": 3,
      "name": "Music",
      "order": 3,
      "in_use": true
    }
  ],
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/categories/set_categories.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user.
- action: the action to perform ('add', 'edit', 'delete').
- name: (required for 'add' and 'edit') the name of the category.
- id / categoryId: (required for 'edit' and 'delete') the ID of the category.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).
- categoryId: (only for successful 'add' action) the ID of the newly created category (integer).

Example response:
{
  "success": true,
  "title": "Category added",
  "categoryId": 4,
  "message": "Category added successfully."
}
```

**Reads:** $_POST['action'] $_POST['apiKey'] $_POST['api_key'] $_POST['categoryId'] $_POST['id'] $_POST['name']

## `api/currencies/get_currencies.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- main_currency: the main currency of the user (integer).
- currencies: an array of currencies.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "currencies",
  "main_currency": 3,
  "currencies": [
    {
      "id": 1,
      "name": "US Dollar",
      "symbol": "$",
      "code": "USD",
      "rate": "1.1000",
      "in_use": true
    },
    {
      "id": 2,
      "name": "Japanese Yen",
      "symbol": "¥",
      "code": "JPY",
      "rate": "150.0000",
      "in_use": true
    },
    {
      "id": 3,
      "name": "Euro",
      "symbol": "€",
      "code": "EUR",
      "rate": "1.0000",
      "in_use": true
    }
  ],
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/currencies/set_currencies.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user.
- action: the action to perform ('add', 'edit', 'delete').
- name: (required for 'add' and 'edit') the name of the currency.
- symbol: (required for 'add' and 'edit') the symbol of the currency (e.g. $, €).
- code: (required for 'add' and 'edit') the currency code (e.g. USD, EUR).
- rate: (optional for 'add' and 'edit') the exchange rate (default: 1.0).
- id / currencyId: (required for 'edit' and 'delete') the ID of the currency.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).
- currencyId: (only for successful 'add' action) the ID of the newly created currency (integer).

Example response:
{
  "success": true,
  "title": "Currency added",
  "currencyId": 5,
  "message": "Currency added successfully."
}
```

**Reads:** $_POST['action'] $_POST['apiKey'] $_POST['api_key'] $_POST['code'] $_POST['currencyId'] $_POST['id'] $_POST['name'] $_POST['rate'] $_POST['symbol']

## `api/fixer/get_fixer.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- fixer: an object containing the Fixer settings.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "fixer",
  "fixer": {
    "api_key": "********",
    "provider": 0,
    "provider_name": "Fixer.io"
  },
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/fixer/set_fixer.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user (for Wallos authentication).
- fixer_api_key: the Fixer.io or APILayer API key to save (optional; if empty/omitted, clears the key).
- provider: the provider type (optional; '0' for Fixer.io, '1' for APILayer.com, defaults to '0').

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).

Example response:
{
  "success": true,
  "title": "Fixer settings updated",
  "message": "Fixer API key has been saved."
}
```

**Reads:** $_POST['apiKey'] $_POST['api_key'] $_POST['fixer_api_key'] $_POST['provider']

## `api/household/get_household.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- household: an array of household members.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "household",
  "household": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "in_use": true
    },
    {
      "id": 2,
      "name": "Jane Doe",
      "email": "jane@example.com",
      "in_use": true
    }
  ],
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/household/set_household.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user.
- action: the action to perform ('add', 'edit', 'delete').
- name: (required for 'add' and 'edit') the name of the household member.
- email: (optional for 'add' and 'edit') the email of the household member.
- id / memberId: (required for 'edit' and 'delete') the ID of the household member.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).
- memberId: (only for successful 'add' action) the ID of the newly created member (integer).

Example response:
{
  "success": true,
  "title": "Member added",
  "memberId": 3,
  "message": "Household member added successfully."
}
```

**Reads:** $_POST['action'] $_POST['apiKey'] $_POST['api_key'] $_POST['email'] $_POST['id'] $_POST['memberId'] $_POST['name']

## `api/notifications/get_notification_settings.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- notification_settings: an object containing the notification settings, for the enabled methods.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "notification_settings",
  "notification_settings": {
    "id": 1,
    "days": 1,
    "email_notifications": {
      "enabled": 1,
      "smtp_address": "smtp.example.com",
      "smtp_port": 587,
      "smtp_username": "user@example.com",
      "smtp_password": "********",
      "from_email": "no-reply@example.com",
      "encryption": "tls",
      "other_emails": "other@example.com"
    },
    "discord_notifications": {
      "enabled": 1,
      "webhook_url": "https://discord.com/api/webhooks/..."
    },
    "gotify_notifications": {
      "enabled": 1,
      "host": "https://gotify.example.com",
      "token": "********",
      "priority": 5
    },
    "ntfy_notifications": {
      "enabled": 0,
      "host": "http://notify.example.com",
      "topic": "example_topic",
      "headers": "********",
      "priority": 3
    },
    "pushover_notifications": {
      "enabled": 1,
      "token": "********",
      "user_key": "userkey123",
      "title": "Wallos",
      "priority": 0,
      "sound": "pushover"
    },
    "telegram_notifications": {
      "enabled": 1,
      "bot_token": "********",
      "chat_id": "12345678"
    },
    "webhook_notifications": {
      "enabled": 1,
      "url": "https://example.com/webhook",
      "headers": "********"
    },
    "serverchan_notifications": {
      "enabled": 1,
      "sendkey": "********"
    }
  },
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/payment_methods/get_payment_methods.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- payment_methods: an array of payment methods.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "payment_methods",
  "payment_methods": [
    {
      "id": 1,
      "name": "PayPal",
      "icon": "images/uploads/icons/paypal.png",
      "enabled": 1,
      "order": 1,
      "in_use": true
    },
    {
      "id": 2,
      "name": "Credit Card",
      "icon": "images/uploads/icons/creditcard.png",
      "enabled": 1,
      "order": 2,
      "in_use": true
    },
    {
      "id": 3,
      "name": "Bank Transfer",
      "icon": "images/uploads/icons/banktransfer.png",
      "enabled": 1,
      "order": 3,
      "in_use": false
    },
    {
      "id": 4,
      "name": "Direct Debit",
      "icon": "images/uploads/icons/directdebit.png",
      "enabled": 1,
      "order": 4,
      "in_use": false
    },
    {
      "id": 5,
      "name": "Cash",
      "icon": "images/uploads/icons/cash.png",
      "enabled": 1,
      "order": 5,
      "in_use": false
    },
    {
      "id": 6,
      "name": "Google Pay",
      "icon": "images/uploads/icons/googlepay.png",
      "enabled": 1,
      "order": 6,
      "in_use": true
    }
  ],
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/payment_methods/set_payment_methods.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user (for Wallos authentication).
- action: the action to perform ('add', 'edit', 'delete').
- name: (required for 'add', optional for 'edit') the name of the payment method.
- enabled: (optional for 'add' and 'edit'; '1' for enabled, '0' for disabled).
- icon_url: (optional for 'add' and 'edit') the URL of the icon to fetch.
- paymenticon: (optional for 'add' and 'edit') the uploaded image file.
- id / paymentId: (required for 'edit' and 'delete') the ID of the payment method.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).
- paymentId: (only for successful 'add' action) the ID of the newly created payment method (integer).

Example response:
{
  "success": true,
  "title": "Payment method added",
  "paymentId": 32,
  "message": "Payment method added successfully."
}
```

**Reads:** $_FILES['paymenticon'] $_POST['action'] $_POST['apiKey'] $_POST['api_key'] $_POST['enabled'] $_POST['icon-url'] $_POST['icon_url'] $_POST['id'] $_POST['name'] $_POST['paymentId']

## `api/settings/get_settings.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- settings: an object containing the user settings.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "settings",
  "settings": {
    "dark_theme": 0,
    "monthly_price": 1,
    "convert_currency": 1,
    "remove_background": 1,
    "color_theme": "red",
    "hide_disabled": 0,
    "disabled_to_bottom": 1,
    "show_original_price": 0,
    "mobile_nav": 1,
    "show_subscription_progress": 0,
    "week_starts_sunday": 0,
    "square_icons": 0,
    "custom_colors": {
      "main_color": "#0000ff",
      "accent_color": "#00ffff",
      "hover_color": "#00008b"
    },
    "custom_css": {
      "css": "body { background: #000; }"
    }
  },
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/settings/set_settings.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user (for Wallos authentication).
- dark_theme: (optional) '0' (light), '1' (dark), or '2' (automatic).
- color_theme: (optional) 'blue', 'green', 'red', 'yellow', 'purple', or 'custom'.
- monthly_price: (optional) '1' or '0' (show monthly prices).
- convert_currency: (optional) '1' or '0' (convert to main currency).
- show_original_price: (optional) '1' or '0' (show original prices next to converted).
- mobile_nav: (optional) '1' or '0' (use mobile navigation menu).
- show_subscription_progress: (optional) '1' or '0' (show subscription progress bars).
- week_starts_sunday: (optional) '1' or '0' (start calendar weeks on Sunday).
- disabled_to_bottom: (optional) '1' or '0' (move disabled subscriptions to bottom).
- hide_disabled: (optional) '1' or '0' (hide disabled subscriptions).
- remove_background: (optional) '1' or '0' (remove background from logos).
- square_icons: (optional) '1' or '0' (use square icon frames).
- main_color: (optional) Custom theme primary color (hex format, e.g. #0000ff).
- accent_color: (optional) Custom theme accent color (hex format, e.g. #00ffff).
- hover_color: (optional) Custom theme hover color (hex format, e.g. #00008b).
- css: (optional) Custom CSS styling rules to apply to the web interface.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).

Example response:
{
  "success": true,
  "title": "Settings updated",
  "message": "User settings have been saved successfully."
}
```

**Reads:** $_POST[$postKey] $_POST['accentColor'] $_POST['accent_color'] $_POST['apiKey'] $_POST['api_key'] $_POST['color_theme'] $_POST['css'] $_POST['dark_theme'] $_POST['hoverColor'] $_POST['hover_color'] $_POST['mainColor'] $_POST['main_color']

## `api/status/version.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- version: a string containing the version matching the github package version.
- version_number: a string containing the version number.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "version",
  "version": "v2.42.1",
  "version_number": "2.42.1",
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']

## `api/subscriptions/get_ical_feed.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- convert_currency: whether to convert to the main currency (boolean) default false.
- api_key: the API key of the user.

It returns a downloadable VCAL file with the active subscriptions
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key'] $_REQUEST['convert_currency']

## `api/subscriptions/get_monthly_cost.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- month: the month for which the cost is to be calculated (integer).
- year: the year for which the cost is to be calculated (integer).
- api_key: the API key of the user (string).

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: a string with "${month} ${year}" (e.g., "March 2025").
- monthly_cost: a float with the total cost for the given month.
- localized_monthly_cost: a string with the total cost formatted according to the user's locale and currency.
- currency_code: a string with the currency code of the user's main currency.
- currency_symbol: a string with the currency symbol of the user's main currency.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "March 2025",
  "monthly_cost": "120.24",
  "localized_monthly_cost": "€120.24",
  "currency_code": "EUR",
  "currency_symbol": "€",
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key'] $_REQUEST['month'] $_REQUEST['year']

## `api/subscriptions/get_subscription.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user (string, required).
- id / subscription_id: the ID of the subscription to retrieve (integer, required).
- convert_currency: whether to convert the price to the user's main currency (boolean, default false).

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- subscription: an object containing the subscription details.
- notes: warning messages or additional information (array).

Example response:
{
  "success": true,
  "title": "subscription",
  "subscription": {
    "id": 1,
    "name": "Netflix",
    "logo": "1719827361-payments-netflix.png",
    "price": 15.99,
    "currency_id": 1,
    "start_date": "2026-01-01",
    "next_payment": "2026-08-01",
    "cycle": 3,
    "frequency": 1,
    "auto_renew": 1,
    "notes": "Premium plan",
    "payment_method_id": 2,
    "payer_user_id": 1,
    "category_id": 3,
    "notify": 1,
    "url": "https://netflix.com",
    "inactive": 0,
    "notify_days_before": 2,
    "user_id": 1,
    "cancelation_date": null,
    "cancellation_date": "",
    "category_name": "Entertainment",
    "payer_user_name": "John Doe",
    "payment_method_name": "PayPal"
  },
  "notes": []
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key'] $_REQUEST['convert_currency'] $_REQUEST['id'] $_REQUEST['subscriptionId'] $_REQUEST['subscription_id']

## `api/subscriptions/get_subscriptions.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- member: comma-separated IDs of the members to filter (integer) default null.
- category: the ID of the category to filter (integer) default null.
- payment_method: the ID of the payment method to filter (integer) default null.
- state: the state of the subscription to filter (boolean) default null [0 - active, 1 - inactive].
- disabled_to_bottom: whether to sort the inactive subscriptions to the bottom (boolean) default false.
- sort: the sorting method (string) default next_payment ['name', 'id', 'next_payment', 'price', 'payer_user_id', 'category_id', 'payment_method_id', 'inactive', 'alphanumeric'].
- convert_currency: whether to convert to the main currency (boolean) default false.
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- subscriptions: an array of subscriptions.
- notes: warning messages or additional information (array).

Example response:
{
    "success": true,
    "title": "subscriptions",
    "subscriptions": [
        {
            "id": 1,
            "name": "Example Subscription",
            "logo": "example.png",
            "price": 10.00,
            "currency_id": 1,
            "start_date": "2024-09-01",
            "next_payment": "2024-09-01",
            "cycle": 1,
            "frequency": 1,
            "auto_renew": 1,
            "notes": "Example note",
            "payment_method_id": 1,
            "payer_user_id": 1,
            "category_id": 1,
            "notify": 1,
            "url": "https://example.com",
            "inactive": 0,
            "notify_days_before": 1,
            "user_id": 1,
            "cancelation_date": null,
            "cancellation_date": "",
            "category_name": "General",
            "payer_user_name": "John Doe",
            "payment_method_name": "PayPal"
        },
        {
            "id": 2,
            "name": "Another Subscription",
            "logo": "another.png",
            "price": 15.00,
            "currency_id": 2,
            "start_date": "2024-09-02",
            "next_payment": "2024-09-02",
            "cycle": 1,
            "frequency": 1,
            "auto_renew": 0,
            "notes": "",
            "payment_method_id": 2,
            "payer_user_id": 2,
            "category_id": 2,
            "notify": 0,
            "url": "",
            "inactive": 1,
            "notify_days_before": null,
            "user_id": 2,
            "cancelation_date": null,
            "cancellation_date": "",
            "category_name": "Entertainment",
            "payer_user_name": "Jane Doe",
            "payment_method_name": "Credit Card",
            "replacement_subscription_id": 1
        }
    ],
    "users": [
        {
            "id": 1,
            "name": "admin",
            "email": "admin@example.com"
        },
        {
            "id": 2,
            "name": "user",
            "email": "user@example.com"
        }
    ],
    "notes": []
}
```

**Reads:** $_REQUEST['all-user-subscription'] $_REQUEST['apiKey'] $_REQUEST['api_key'] $_REQUEST['category'] $_REQUEST['convert_currency'] $_REQUEST['disabled_to_bottom'] $_REQUEST['member'] $_REQUEST['payment'] $_REQUEST['sort'] $_REQUEST['state']

## `api/subscriptions/set_subscriptions.php`

**Accepts:** POST (form-encoded)

```
This API Endpoint accepts POST requests only.
It receives the following parameters:
- api_key: the API key of the user (for Wallos authentication).
- action: the action to perform ('add', 'edit', 'delete').
- id / subscription_id: (required for 'edit' and 'delete') the ID of the subscription.

For 'add' and 'edit' actions (all optional for 'edit'):
- name: the name of the subscription.
- price: the price of the subscription (float).
- currency_id: the currency ID of the subscription (integer).
- frequency: the payment frequency (integer).
- cycle: the payment cycle (integer: 1-days, 2-weeks, 3-months, 4-years).
- next_payment: the next payment date (YYYY-MM-DD).
- start_date: the start date of the subscription (YYYY-MM-DD).
- auto_renew: whether the subscription auto renews (1 or 0, default 1).
- payment_method_id: the payment method ID (integer).
- payer_user_id: the household member payer ID (integer).
- category_id: the category ID (integer).
- notes: subscription notes (string).
- url: subscription URL (string).
- logo_url: an image URL to download as the logo (string).
- logo: direct image file upload for the logo.
- notify / notifications: whether to send payment notifications (1 or 0).
- notify_days_before: how many days before to send notification (integer).
- inactive: whether the subscription is inactive (1 or 0).
- cancellation_date: the cancellation date (YYYY-MM-DD).
- replacement_subscription_id: the ID of the replacement subscription (integer).

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- message: detailed information or error message (string).
- subscriptionId: (only for successful 'add' action) the ID of the newly created subscription (integer).

Example response:
{
  "success": true,
  "title": "Subscription added",
  "subscriptionId": 55,
  "message": "Subscription added successfully."
}
```

**Reads:** $_FILES['logo'] $_POST['action'] $_POST['apiKey'] $_POST['api_key'] $_POST['auto_renew'] $_POST['cancellation_date'] $_POST['category_id'] $_POST['currency_id'] $_POST['cycle'] $_POST['frequency'] $_POST['id'] $_POST['inactive'] $_POST['logo-url'] $_POST['logo_url'] $_POST['name'] $_POST['next_payment'] $_POST['notes'] $_POST['notifications'] $_POST['notify'] $_POST['notify_days_before'] $_POST['payer_user_id'] $_POST['payment_method_id'] $_POST['price'] $_POST['replacement_subscription_id'] $_POST['start_date'] $_POST['subscriptionId'] $_POST['subscription_id'] $_POST['url']

## `api/users/get_user.php`

**Accepts:** GET or POST

```
This API Endpoint accepts both POST and GET requests.
It receives the following parameters:
- api_key: the API key of the user.

It returns a JSON object with the following properties:
- success: whether the request was successful (boolean).
- title: the title of the response (string).
- notes: warning messages or additional information (array).
- user: an object containing the user details.

Example response:
{
  "success": true,
  "title": "user",
  "user": {
    "id": 1,
    "username": "johndoe",
    "email": "john.doe@example.com",
    "password": "********",
    "main_currency": 1,
    "avatar": "images/uploads/logos/avatars/default-avatar.jpg",
    "language": "en",
    "budget": 100,
    "totp_enabled": 0,
    "api_key": "********"
  },
  "notes": ""
}
```

**Reads:** $_REQUEST['apiKey'] $_REQUEST['api_key']


## Behaviour confirmed against a running v5.2.0 instance

- The HTTP status is `200` for every outcome, authentication failures included.
  `success` in the body is the only signal.
- A JSON request body is not read at all: PHP fills `$_POST` only for
  `application/x-www-form-urlencoded` and `multipart/form-data`, so a JSON body
  answers `{"success":false,"title":"Missing API key"}` even when the key is in
  it.
- A read answers with `success`, `title`, its own payload key, and `notes` — an
  array carrying warnings such as a stale exchange rate. The `users` array shown
  in the `get_subscriptions.php` docblock is not part of the v5.2.0 response.
- `get_currencies.php` carries `main_currency` beside the list, which is the
  currency a subscription falls back to.
- Category, currency, payment-method and household entries each carry `in_use`,
  which tells a caller whether deleting one would orphan a subscription.
- `get_monthly_cost.php` returns money as display strings: `monthly_cost` is
  grouped by thousands separator ("88,242.55") and `localized_monthly_cost` is
  fully formatted ("¥88,243"). Neither parses as a number without stripping the
  separators.
- `get_subscriptions.php` reads the payment filter as `payment`; the
  `payment_method` its docblock names is never read, and passing it returns the
  unfiltered list with `success: true`.
- `get_ical_feed.php` accepts `convert_currency` and builds the calendar from a
  second, unconverted read, so prices come back in each subscription's own
  currency whatever the flag says.
- `all-user-subscription=1` combined with any filter builds `SELECT * FROM
  subscriptions AND …`, which fatals.

The last three are reported upstream as ellite/Wallos#1157, #1158 and #1159.
