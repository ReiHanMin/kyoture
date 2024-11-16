<?php

namespace App\Services\DataTransformers;

use App\Models\Event;
use App\Models\Venue;
use App\Models\Price;
use App\Models\Image;
use App\Models\Category;
use App\Models\Tag;
use App\Models\Schedule;
use App\Models\EventLink;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Database\QueryException;

class KyotoConcertHallDataTransformer implements DataTransformerInterface
{
    public function transform(array $eventData): ?array
{
    Log::info('Dispatching job for event data', ['event_data' => $eventData]);

    // Dispatch the job, passing the transformer class name
    \App\Jobs\ProcessEventData::dispatch(static::class, $eventData);

    // Return immediately to prevent long processing in the HTTP request
    return null;
}

    public function processEvent(array $eventData): ?array
    {
        Log::info('Starting transformation process for event data', ['event_data' => $eventData]);

        // Call OpenAI API to transform data
        $prompt = $this->constructPrompt($eventData);
        Log::info('Constructed OpenAI prompt', ['prompt' => $prompt]);

        $responseData = $this->callOpenAI($prompt);

        if (!empty($responseData) && isset($responseData['events'])) {
            Log::info('OpenAI response received', ['response_data' => $responseData]);

            foreach ($responseData['events'] as &$processedEvent) {
                // Append the original description to each processed event
                $processedEvent['description'] = $eventData['description'] ?? '';
                $this->processAndSaveEvent($processedEvent);
            }

            return $responseData;
        }

        Log::warning('API response is empty or malformed.', ['response' => $responseData]);
        return null;
    }



    public function processAndSaveEvent(array $eventData): void
    {
        Log::info('Processing event data for saving', ['event_data' => $eventData]);

        $eventData['external_id'] = md5("{$eventData['title']}_{$eventData['date_start']}_{$eventData['venue']}");
        Log::info('Generated external_id', ['external_id' => $eventData['external_id']]);

        $eventData['venue_id'] = $this->saveVenue($eventData['venue']) ?? null;
        Log::info('Venue ID assigned', ['venue_id' => $eventData['venue_id']]);

        if ($this->isValidEventData($eventData)) {
            // Check if the event link already exists
            $existingEvent = Event::where('external_id', $eventData['external_id'])->first();

            if ($existingEvent) {
                // Update the existing event
                $event = $this->updateEvent($existingEvent->id, $eventData); // Use $existingEvent->id directly
                Log::info('Existing event updated', ['event_id' => $event->id]);
            } else {
                // Create a new event
                $event = $this->saveEvent($eventData);
                Log::info('New event created', ['event_id' => $event->id]);
            }


            if ($event) {
                $this->saveEventLink($event->id, $eventData['event_link']);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link']]);
            }
        } else {
            Log::warning('Invalid event data', ['event_data' => $eventData]);
        }
    }

    public function updateEvent(int $eventId, array $eventData): ?Event
    {
        try {
            Log::info('Updating existing event', ['event_id' => $eventId]);

            $event = Event::find($eventId);

            if ($event) {
                $event->update([
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'] ?? null,
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    'program' => $eventData['program'] ?? null,
                    'sold_out' => $eventData['sold_out'] ?? false,
                ]);

                // Update related data
                $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
                $this->saveCategories($event, $eventData['categories'] ?? []);
                $this->saveTags($event, $eventData['tags'] ?? []);
                $this->saveImages($event, $eventData['image_url'] ?? null, []);
                $this->savePrices($event->id, $eventData['prices'] ?? []);

                return $event;
            } else {
                Log::warning('Event not found for updating', ['event_id' => $eventId]);
            }
        } catch (QueryException $qe) {
            Log::error('Database error while updating event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }


    public function constructPrompt(array $eventData): string
    {
        // Ensure eventData is not empty
        if (empty($eventData)) {
            Log::warning('Empty event data provided to constructPrompt.');
            return "No event data provided.";
        }
    
        // Safely encode eventData to JSON
        $jsonEventData = json_encode($eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($jsonEventData === false) {
            Log::error('Failed to JSON encode event data.', ['event_data' => $eventData]);
            return "Invalid event data provided.";
        }
    
        // Constructing a detailed and precise prompt using Heredoc syntax
            $prompt = <<<EOT
        Transform the provided event data into the specified JSON format with the following requirements:
        
        1. **Date Parsing**:
        - Parse 'raw_date' into 'date_start' and 'date_end':
            - Use 'YYYY-MM-DD' format for dates.
            - Extract the date from 'raw_date', even if it contains day names or extra text.
            - If 'raw_date' includes a time, separate it accordingly.
        
        2. **Schedule Parsing**:
        - Create a 'schedule' array with entries that include 'date', 'time_start', 'time_end', and 'special_notes'.
        - If the time is available in 'raw_date' or 'raw_schedule', include it in 'time_start'.
        - If no time is available, set 'time_start' as '00:00:00'.
        
        3. **Category Assignment**:
        - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
            ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports'].
        
        4. **Tag Assignment**:
        - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
            ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event'].
        
        5. **Price Parsing**:
        - Extract pricing information from 'raw_price_text' and format it as an array of price objects:
            - Each price object should include 'price_tier', 'amount', 'currency', and 'discount_info'.
            - 'amount' should be numeric, excluding currency symbols.
            - Assume 'currency' to be 'JPY' if not specified.
            - Include 'discount_info' if available.
        
        6. **Sold Out Status**:
        - If the event is sold out (indicated by 'SOLD OUT' in the title or 'releaseDate'), set 'sold_out' to true. Otherwise, set it to false.

        
        7. **Output Format**:
        - Ensure the output strictly follows the specified JSON format, even if some fields are empty:
            {
                
                "events": [
                    {
                        "title": "Event Title",
                        "date_start": "YYYY-MM-DD",
                        "date_end": "YYYY-MM-DD",
                        "organization": "Organization name",
                        "venue": "Venue Name",
                        "event_link": "Event URL",
                        "image_url": "Image URL",
                        "sold_out": true/false,
                        "schedule": [
                            {
                                "date": "YYYY-MM-DD",
                                "time_start": "HH:mm:ss",
                                "time_end": "HH:mm:ss",
                                "special_notes": "Special Notes"
                            }
                        ],
                        "categories": ["Category1", "Category2"],
                        "tags": ["Tag1", "Tag2"],
                        "prices": [
                            {
                                "price_tier": "Tier1",
                                "amount": "1000",
                                "currency": "JPY",
                                "discount_info": "Discount Info"
                            }
                        ]
                    }
                ]
            } 
        
        EVENT DATA TO BE PARSED: {$jsonEventData}
        EOT;
    
        // Log the constructed prompt for debugging
        Log::info('Constructed prompt:', ['prompt' => $prompt]);
    
        return $prompt;
    }
    



    public function callOpenAI(string $prompt): ?array
    {
        $apiKey = env('OPENAI_API_KEY');

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $apiKey,
            ])->post('https://api.openai.com/v1/chat/completions', [
                'model' => 'gpt-4o-mini',  // Correct model name
                'messages' => [
                    ['role' => 'user', 'content' => $prompt],
                ],
                'max_tokens' => 1000,  // Adjust if needed
                'temperature' => 0.2,
            ]);

            // Handle rate limits or other transient errors
            if ($response->status() == 429) {
                Log::warning('Rate limit hit. Retrying after delay.');
                sleep(5); // Wait before retrying
                return $this->callOpenAI($prompt); // Recursive retry
            }

            $responseArray = $response->json();

            if (isset($responseArray['choices'][0]['message']['content'])) {
                // Get the content
                $parsedData = $responseArray['choices'][0]['message']['content'];
                
                // Use regex to extract JSON between braces
                if (preg_match('/\{(?:[^{}]|(?R))*\}/s', $parsedData, $matches)) {
                    $jsonContent = $matches[0];  // Extracted JSON string
                    Log::info('Extracted JSON from OpenAI response', ['response' => $jsonContent]);

                    // Decode the JSON
                    return json_decode($jsonContent, true);
                } else {
                    Log::warning('No JSON found in OpenAI response', ['response' => $parsedData]);
                }
            } else {
                Log::warning('No content in OpenAI response', ['response' => $responseArray]);
            }
        } catch (\Exception $e) {
            Log::error('Error calling OpenAI API', ['error' => $e->getMessage()]);
        }

        return null;
    }



    // Implement the helper methods
    public function saveVenue(string $venueName): int
    {
        // Save or retrieve the venue and return its ID
        $venue = Venue::firstOrCreate(['name' => $venueName]);
        return $venue->id;
    }

    public function saveEvent(array $eventData): ?Event
    {
        try {
            Log::info('Creating or updating event', ['event_data' => $eventData]);

            // Ensure 'external_id' is present
            if (!isset($eventData['external_id'])) {
                Log::warning('External ID missing for event', ['event_data' => $eventData]);
                return null;
            }

            Log::info('Saving event in updateOrCreate with external_id:', ['external_id' => $eventData['external_id']]);
            Log::info('Preparing to save event with organization and description', [
                'organization' => $eventData['organization'] ?? 'Not set',
                'description' => $eventData['description'] ?? 'Not set'
            ]);
            
            // Use 'external_id' to find and update the event, or create a new one
            $event = Event::updateOrCreate(
                ['external_id' => $eventData['external_id']], // Matching Attributes
                [ // Values to Update/Create
                    'title' => $eventData['title'],
                    'organization' => $eventData['organization'] ?? null,
                    'description' => $eventData['description'] ?? null,
                    'date_start' => $eventData['date_start'],
                    'date_end' => $eventData['date_end'],
                    'venue_id' => $eventData['venue_id'],
                    'program' => $eventData['program'] ?? null,
                    'sold_out' => $eventData['sold_out'] ?? false,

                ]
            );

            Log::info('Event saved successfully', ['event_id' => $event->id]);

            // Save related data
            $this->saveSchedules($event->id, $eventData['schedule'] ?? []);
            $this->saveCategories($event, $eventData['categories'] ?? []);
            $this->saveTags($event, $eventData['tags'] ?? []);
            $this->saveImages($event, $eventData['image_url'] ?? null, []);
            $this->savePrices($event->id, $eventData['prices'] ?? []);

            return $event;
        } catch (QueryException $qe) {
            Log::error('Database error while saving event', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_data' => $eventData,
            ]);
        }

        return null;
    }

    public function isValidEventData(array $eventData): bool
    {
        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
            'external_id' => 'required|string|unique:events,external_id',
            'event_link' => 'required|string',
        ]);

        if ($validator->fails()) {
            Log::error('Validation failed:', $validator->errors()->all());
            return false;
        }

        return true;
    }




    public function saveSchedules(int $eventId, array $schedules)
    {
        foreach ($schedules as $scheduleData) {
            Schedule::updateOrCreate(
                [
                    'event_id' => $eventId,
                    'date' => $scheduleData['date'],
                ],
                [
                    'time_start' => $this->nullIfEmpty($scheduleData['time_start']),
                    'time_end' => $this->nullIfEmpty($scheduleData['time_end']),
                    'special_notes' => $this->nullIfEmpty($scheduleData['special_notes']),
                ]
            );            
        }
    }

    public function nullIfEmpty($value)
    {
    return isset($value) && $value !== '' ? $value : null;
    }


    public function saveImages(Event $event, ?string $primaryImageUrl, array $images = []): void
    {
        // Save the primary image if available
        if ($primaryImageUrl) {
            Image::updateOrCreate(
                [
                    'event_id' => $event->id,
                    'image_url' => $primaryImageUrl,
                ],
                [
                    'alt_text' => 'Main Event Image',
                    'is_featured' => true,
                ]
            );
        }

        // Save additional images if provided
        foreach ($images as $imageData) {
            if (!empty($imageData['image_url'])) {
                Image::updateOrCreate(
                    [
                        'event_id' => $event->id,
                        'image_url' => $imageData['image_url'],
                    ],
                    [
                        'alt_text' => $imageData['alt_text'] ?? 'Additional Event Image',
                        'is_featured' => $imageData['is_featured'] ?? false,
                    ]
                );
            }
        }
    }



    public function savePrices(int $eventId, array $prices)
    {
        foreach ($prices as $priceData) {
            Price::updateOrCreate(
                [
                    'event_id' => $eventId,
                    'price_tier' => $priceData['price_tier'],
                ],
                [
                    'amount' => $this->nullIfEmpty($priceData['amount']),
                    'currency' => $priceData['currency'] ?? 'JPY',
                    'discount_info' => $this->nullIfEmpty($priceData['discount_info']),
                ]
            );            
        }
    }

    public function saveCategories(Event $event, array $categories)
    {
        foreach ($categories as $categoryName) {
            $category = Category::updateOrCreate(['name' => $categoryName]);
            $event->categories()->syncWithoutDetaching([$category->id]);
        }
    }


    public function saveTags(Event $event, array $tags)
    {
        foreach ($tags as $tagName) {
            $tag = Tag::firstOrCreate(['name' => $tagName]);
            $event->tags()->syncWithoutDetaching([$tag->id]);
        }
    }


    public function saveEventLink(int $eventId, string $eventLink)
    {
        EventLink::updateOrCreate(
            [
                'event_id' => $eventId,
                'url' => $eventLink,
            ]
        );
    }
}
