# Node with Debian so we can apt-get ffmpeg
FROM node:18-bullseye

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Create app dir
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app
COPY . .

# Expose (Fly will route to this)
EXPOSE 3000

CMD ["npm", "start"]
