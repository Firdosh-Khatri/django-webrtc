from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('meeting/', views.home, name='meeting'),
    path('meeting/<str:room_id>/', views.room, name='meeting_room'),
    path('create-room/', views.create_room, name='create_room'),
    path('join-room/', views.join_room, name='join_room'),
    path('recording/<str:recording_id>/', views.get_recording_url, name='recording'),
]


