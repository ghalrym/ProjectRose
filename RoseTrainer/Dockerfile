FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY data/ data/
COPY main.py .

EXPOSE 8030

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8030"]
