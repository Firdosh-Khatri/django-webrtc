from django.shortcuts import render, redirect
import boto3
import uuid

def home(request):
    return render(request, "chat/home.html")

def room(request, room_id=None):
    # If room_id is not provided, redirect to home
    if not room_id:
        return redirect('home')
    
    # Get username from session or use default
    username = request.session.get('username', 'Anonymous')
    
    context = {
        'room_id': room_id,
        'username': username
    }
    return render(request, "chat/room.html", context)

def create_room(request):
    if request.method == 'POST':
        room_name = request.POST.get('room_name')
        username = request.POST.get('username')
        
        # Generate a unique room ID
        room_id = str(uuid.uuid4())[:8]
        
        # Store username in session
        request.session['username'] = username
        
        # Redirect to the room
        return redirect('meeting_room', room_id=room_id)
    
    return redirect('home')

def join_room(request):
    if request.method == 'POST':
        room_id = request.POST.get('room_id')
        username = request.POST.get('username')
        
        # Store username in session
        request.session['username'] = username
        
        # Redirect to the room
        return redirect('meeting_room', room_id=room_id)
    
    return redirect('home')

def get_recording_url(request, recording_id):
    s3 = boto3.client('s3')
    url = s3.generate_presigned_url('get_object', Params={
        'Bucket': 'mybucket',
        'Key': f'{recording_id}.mp4'
    }, ExpiresIn=3600)
    return redirect(url)
