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
    
    // Generate external_id using the original scraped title, date_start, and venue
    $title = strtolower(trim($eventData['title']));
    $dateStart = $eventData['date_start'];
    $venue = strtolower(trim($eventData['venue'] ?? ''));
    
    $uniqueString = "{$title}|{$dateStart}|{$venue}";
    $eventData['external_id'] = md5($uniqueString);
    
    // Call OpenAI API to generate tags and categories
    $prompt = $this->constructPrompt($eventData);
    Log::info('Constructed OpenAI prompt', ['prompt' => $prompt]);
    
    $responseData = $this->callOpenAI($prompt);
    
    if (!empty($responseData) && isset($responseData['events'])) {
        Log::info('OpenAI response received', ['response_data' => $responseData]);
        
        foreach ($responseData['events'] as &$processedEvent) {
            // Use the original title from the scraped data
            $processedEvent['title'] = $eventData['title'];
            $processedEvent['description'] = $eventData['description'] ?? '';
            $processedEvent['external_id'] = $eventData['external_id'];

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

        Log::info('Generated external_id', ['external_id' => $eventData['external_id']]);

        $eventData['venue_id'] = $this->saveVenue($eventData['venue']) ?? null;
        Log::info('Venue ID assigned', ['venue_id' => $eventData['venue_id']]);

        if ($this->isValidEventData($eventData)) {
            // Check if the event already exists using external_id
            $existingEvent = Event::where('external_id', $eventData['external_id'])->first();

            if ($existingEvent) {
                // Update the existing event
                $event = $this->updateEvent($existingEvent->id, $eventData);
                Log::info('Existing event updated', ['event_id' => $event->id]);
            } else {
                // Create a new event
                $event = $this->saveEvent($eventData);
                Log::info('New event created', ['event_id' => $event->id]);
            }

            // Save the event link if it exists
            if (!empty($eventData['event_link'])) {
                $this->saveEventLink($event->id, $eventData['event_link']);
                Log::info('Event link saved', ['event_id' => $event->id, 'event_link' => $eventData['event_link']]);
            } else {
                Log::info('No event_link provided, skipping saveEventLink call.', ['event_id' => $event->id]);
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
        if (empty($eventData)) {
            Log::warning('Empty event data provided to constructPrompt.');
            return "No event data provided.";
        }

        $jsonEventData = json_encode($eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($jsonEventData === false) {
            Log::error('Failed to JSON encode event data.', ['event_data' => $eventData]);
            return "Invalid event data provided.";
        }

        $prompt = <<<EOT
        Transform the provided event data into the specified JSON format with the following requirements:
        
        1. **Date Parsing**:
           - Set 'date_start' and 'date_end':
             - Use 'YYYY-MM-DD' format for dates.
        
        2. **Schedule Parsing**:
           - Create a 'schedule' array with entries that include 'date', 'time_start', 'time_end', and 'special_notes'.
        
           3. **Category Assignment**:
           - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
               ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Festival', 'Family', 'Wellness', 'Sports'].
           
           4. **Tag Assignment**:
           - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
               ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event'].

        
        5. **Price Parsing**:
           - Parse information from the 'prices' array.
           - Each price should include:
             - 'price_tier': the description or category of the price (e.g., "Adults").
             - 'amount': the numerical amount, formatted as a string (e.g., "7000").
             - 'currency': use "JPY" for Japanese Yen.
             - 'discount_info': include any available discount details. If no discount information is provided, set 'discount_info' to null.
             
             for example  "All Reserved Seats. Adults ￥5,000(JPY: including Tax)  Under 22 years Old ￥2,500 Club Members ￥4,500" should be parsed as
             {
                "price_tier": "Adults",
                "amount": "5000",
                "currency": "JPY",
                "discount_info": "None"
              }{
                "price_tier": "Under 22 years old",
                "amount": "2500",
                "currency": "JPY",
                "discount_info": "None"
              }{
                "price_tier": "Club Members",
                "amount": "4500",
                "currency": "JPY",
                "discount_info": "None"
              }

        
        5. **Output Format**:
           - Ensure the output strictly follows the JSON format:
             {
               "events": [
                 {
                   "title": "Event Title",
                   "date_start": "YYYY-MM-DD",
                   "date_end": "YYYY-MM-DD",
                   "venue": "Venue Name",
                   "organization": "Organization Name",
                   "event_link": null, // Or omitted if not available
                   "image_url": "Image URL",
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
                       "price_tier": "Adults",
                       "amount": "1000",
                       "currency": "JPY",
                       "discount_info": "Discount Info"
                     }
                   ],
                   "free": false
                 }
               ]
             }
        
        EVENT DATA TO BE PARSED: {$jsonEventData}
        EOT;
        

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
                'model' => 'gpt-4o-mini',
                'messages' => [
                    ['role' => 'user', 'content' => $prompt],
                ],
                'max_tokens' => 1000,
                'temperature' => 0.2,
            ]);

            if ($response->status() == 429) {
                Log::warning('Rate limit hit. Retrying after delay.');
                sleep(5);
                return $this->callOpenAI($prompt);
            }

            $responseArray = $response->json();

            if (isset($responseArray['choices'][0]['message']['content'])) {
                $parsedData = $responseArray['choices'][0]['message']['content'];
                
                if (preg_match('/\{(?:[^{}]|(?R))*\}/s', $parsedData, $matches)) {
                    $jsonContent = $matches[0];
                    Log::info('Extracted JSON from OpenAI response', ['response' => $jsonContent]);
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


    public function saveVenue(string $venueName): int
    {
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
    Log::info('Checking type of $eventData', ['type' => gettype($eventData)]);

    // Check if $eventData is indeed an array
    if (!is_array($eventData)) {
        Log::error('Expected $eventData to be an array, but it is not.', ['event_data' => $eventData]);
        return false;
    }

    $validator = Validator::make($eventData, [
        'title' => 'required|string',
        'date_start' => 'required|date',
        'date_end' => 'required|date',
        'external_id' => 'required|string',
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
    // Log the incoming prices data for debugging
    Log::info('Saving prices for event', ['event_id' => $eventId, 'prices' => $prices]);

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
