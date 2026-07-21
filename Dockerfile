# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Install ffmpeg (required by yt-dlp to merge high-quality video & audio)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /app

# Copy the backend requirements first to leverage Docker cache
COPY backend/requirements.txt /app/backend/

# Install Python dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the rest of the application
COPY . /app

# Expose the port (Render sets the PORT environment variable)
EXPOSE 5000

# Start the Flask application using Gunicorn for production
CMD ["gunicorn", "--chdir", "backend", "--bind", "0.0.0.0:5000", "--timeout", "600", "--workers", "2", "app:app"]
