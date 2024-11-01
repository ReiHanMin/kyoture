<?php

namespace App\Http\Controllers;

use App\Models\Event; // Import the Event model
use Illuminate\Http\Request;

class EventController extends Controller
{
    // List all events

    public function index()
{
    // Fetch all events with related data for frontend display
    $events = Event::with(['prices', 'venue', 'schedules', 'images', 'categories', 'tags', 'eventLinks'])->get();

    // Return the events and their related data as JSON
    return response()->json($events);
}



    // Create a new event
    public function store(Request $request)
    {
        // Validate the request data
        $request->validate([
            'title' => 'required|string|max:255',
            'date' => 'nullable|string|max:255',
            'imageUrl' => 'nullable|string',
            'eventLink' => 'nullable|string',
            'status' => 'nullable|string|max:50',
            'modalContent' => 'nullable|string'
        ]);

        // Create a new event
        $event = Event::create([
            'title' => $request->title,
            'date' => $request->date,
            'imageUrl' => $request->imageUrl,
            'eventLink' => $request->eventLink,
            'status' => $request->status,
            'modalContent' => $request->modalContent,
        ]);

        // Return a success response
        return response()->json($event, 201);
    }

    // Show a single event by ID
    public function show($id)
    {
        // Find the event by ID
        $event = Event::find($id);

        // Check if event exists
        if (!$event) {
            return response()->json(['message' => 'Event not found'], 404);
        }

        // Return the event as JSON
        return response()->json($event);
    }

    // Update an existing event
    public function update(Request $request, $id)
    {
        // Find the event by ID
        $event = Event::find($id);

        // Check if event exists
        if (!$event) {
            return response()->json(['message' => 'Event not found'], 404);
        }

        // Validate the request data
        $request->validate([
            'title' => 'required|string|max:255',
            'date' => 'nullable|string|max:255',
            'imageUrl' => 'nullable|string',
            'eventLink' => 'nullable|string',
            'status' => 'nullable|string|max:50',
            'modalContent' => 'nullable|string'
        ]);

        // Update the event with new data
        $event->update($request->all());

        // Return the updated event as JSON
        return response()->json($event);
    }

    // Delete an event by ID
    public function destroy($id)
    {
        // Find the event by ID
        $event = Event::find($id);

        // Check if event exists
        if (!$event) {
            return response()->json(['message' => 'Event not found'], 404);
        }

        // Delete the event
        $event->delete();

        // Return a success message
        return response()->json(['message' => 'Event deleted successfully']);
    }
}
