HTTP (HyperText Transfer Protocol) is the foundation of data communication on the web.

Key concepts:

Methods: GET (read), POST (create), PUT (full update), PATCH (partial update), DELETE (remove), OPTIONS (capabilities), HEAD (headers only).

Status codes:
- 2xx Success: 200 OK, 201 Created, 204 No Content
- 3xx Redirect: 301 Moved Permanently, 302 Found, 304 Not Modified
- 4xx Client Error: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Too Many Requests
- 5xx Server Error: 500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable

Headers: Content-Type defines body format (application/json, text/html). Authorization carries credentials. Accept tells the server what formats the client understands.

Request body: Sent with POST/PUT/PATCH. Common formats are JSON (application/json) and form data (application/x-www-form-urlencoded or multipart/form-data).

HTTPS: HTTP over TLS. Encrypts the connection between client and server. Always use HTTPS in production.
