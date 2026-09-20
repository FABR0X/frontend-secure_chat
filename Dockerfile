FROM nginx:latest

COPY index.html /usr/share/nginx/html/index.html
COPY app.js /usr/share/nginx/html/app.js
COPY styles.css /usr/share/nginx/html/styles.css
COPY config.js.template /usr/share/nginx/html/config.js.template

COPY nginx.conf.template /etc/nginx/templates/default.conf.template

COPY render-config-js.sh /docker-entrypoint.d/30-render-config-js.sh
RUN chmod +x /docker-entrypoint.d/30-render-config-js.sh
