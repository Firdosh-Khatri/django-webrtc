from django.db import models
from django.contrib.auth.models import User

# Create your models here.

class Room(models.Model):
    name = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_rooms')
    
    def __str__(self):
        return self.name

class Participant(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='room_participants')
    username = models.CharField(max_length=255)
    joined_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('room', 'user')
    
    def __str__(self):
        return f"{self.username} in {self.room.name}"

class Recording(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='recordings')
    file = models.FileField(upload_to='recordings/')
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='recordings')
    
    def __str__(self):
        return f"Recording in {self.room.name} by {self.created_by}"
