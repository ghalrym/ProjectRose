curl is a command-line tool for making HTTP requests.

Common usage patterns:

GET request: curl https://example.com/api/data
POST with JSON: curl -X POST -H "Content-Type: application/json" -d '{"key": "value"}' https://example.com/api
PUT request: curl -X PUT -H "Content-Type: application/json" -d '{"key": "updated"}' https://example.com/api/1
DELETE request: curl -X DELETE https://example.com/api/1

Useful flags:
- -H "Header: Value" — set a request header
- -d "data" — send request body
- -X METHOD — specify HTTP method
- -o file — save output to file
- -s — silent mode, no progress bar
- -v — verbose, show request/response headers
- -L — follow redirects
- -k — skip TLS certificate verification (insecure, only for testing)
- -b "cookies" — send cookies
- -u user:pass — basic authentication
