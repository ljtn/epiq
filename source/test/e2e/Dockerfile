FROM node:22-bookworm

RUN apt-get update && apt-get install -y git python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN git config --global user.name "Epiq E2E"
RUN git config --global user.email "e2e@example.com"
