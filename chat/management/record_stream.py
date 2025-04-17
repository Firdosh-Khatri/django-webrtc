import subprocess

def record_stream():
    command = [
        'ffmpeg',
        '-i', 'input_stream_url',
        '-t', '00:10:00',
        'output.mp4'
    ]
    subprocess.run(command)
