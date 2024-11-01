<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Models\Event;
use App\Models\Venue;
use App\Models\Price;
use App\Models\Category;
use App\Models\Tag;
use App\Models\Schedule;
use App\Models\Image;
use App\Models\EventLink;
use Illuminate\Support\Facades\Http;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Validator;

class ScrapeController extends Controller
{
    public function scrape(Request $request)
    {
        Log::info('Scrape method triggered. Received request:', $request->all());
    
        $request->validate([
            'site' => 'required|string',
            'events' => 'required|array',
        ]);
    
        $events = $request->input('events');
        Log::info('Raw event data received from scraper:', $events);
    
        // Array to store event IDs and their respective links
        $eventLinksToSave = [];
    
        foreach ($events as &$eventData) {
            $eventData['venue_id'] = $this->saveVenue($eventData) ?? null;
            Log::info('Venue ID set for event:', ['venue_id' => $eventData['venue_id']]);
    
            $apiRequestData = $this->prepareDataForAPI($eventData);
            $response = $this->analyzeTextWithOpenAI($apiRequestData);
    
            if (!empty($response) && isset($response['events']) && is_array($response['events'])) {
                $processedEvents = $response['events'];
    
                foreach ($processedEvents as $processedEvent) {
                    $processedEvent['event_link'] = $eventData['event_link'] ?? null;
                    $processedEvent['description'] = $eventData['description'] ?? $processedEvent['description'];
                    $processedEvent['image_url'] = $eventData['image_url'] ?? $processedEvent['image_url'];
                    $processedEvent['venue_id'] = $eventData['venue_id'] ?? null;
                    Log::info('Processed event:', ['Check event_link is in processed_event' => $processedEvent]);
    
                    if ($this->isValidEventData($processedEvent)) {
                        $event = $this->saveEvent($processedEvent);
                        Log::info('Lets check if event->id is in here: ', ['event_id' => $event->id]);
    
                        // Store the event ID and link for later processing
                        if ($event) {
                            $eventLinksToSave[] = [
                                'event_id' => $event->id,
                                'event_link' => $processedEvent['event_link'],
                            ];
                        } else {
                            Log::error('Failed to save event; skipping event link save.', ['event_data' => $processedEvent]);
                        }
                    } else {
                        Log::warning('Invalid event data:', ['processed_event' => $processedEvent]);
                    }
                }            
            } else {
                Log::warning('API response is empty or malformed.', ['response' => $response]);
            }
        }
    
        // Separate loop to save event links after events are created
        foreach ($eventLinksToSave as $linkData) {
            if ($linkData['event_link']) { // Check if event_link is non-null
                $this->saveEventLink($linkData['event_id'], $linkData['event_link']);
            } else {
                Log::warning('Event link missing for event; link save skipped.', ['event_id' => $linkData['event_id']]);
            }
        }
    
        return response()->json([
            'success' => true,
            'message' => 'Events processed and saved successfully!',
        ]);
    }
    


    private function prepareDataForAPI(array $eventData)
    {
        return $eventData;
    }

    private function saveVenue(array $eventData)
    {
        $venue = null;

        if (!empty($eventData['venue'])) {
            $cleanedVenueName = str_replace('Venue : ', '', $eventData['venue']);

            $venue = Venue::firstOrCreate(
                ['name' => $cleanedVenueName],
                [
                    'address' => $eventData['address'] ?? null,
                    'city' => $eventData['city'] ?? null,
                    'postal_code' => $eventData['postal_code'] ?? null,
                    'country' => $eventData['country'] ?? null,
                ]
            );

            Log::info('Venue saved or retrieved from database.', ['venue_id' => $venue->id]);
        } else {
            Log::warning('Venue name is missing; venue data was not saved.', ['eventData' => $eventData]);
        }

        return $venue ? $venue->id : null;
    }

    private function saveEvent(array $eventData)
{
    try {
        Log::info('Attempting to save event:', ['event_data' => $eventData]);

        $existingEvent = Event::where('title', $eventData['title'])
                              ->where('date_start', $eventData['date_start'])
                              ->where('venue_id', $eventData['venue_id'] ?? null)
                              ->first();

        if ($existingEvent) {
            Log::info('Duplicate event detected; skipping save.', ['event_id' => $existingEvent->id, 'title' => $eventData['title']]);
            return $existingEvent;  // Return existing event
        }

        $event = Event::create([
            'title' => $eventData['title'],
            'organization' => $eventData['organization'] ?? null,
            'description' => $eventData['description'] ?? null,
            'date_start' => $eventData['date_start'],
            'date_end' => $eventData['date_end'],
            'venue_id' => $eventData['venue_id'],
        ]);

        Log::info('Event saved successfully:', ['event_id' => $event->id]);

        $this->saveSchedules($event, $eventData['schedule'] ?? []);
        $this->saveCategoriesAndTags($event, $eventData);
        $this->saveImages($event, $eventData['image_url'] ?? null, []);
        $this->savePrices($event, $eventData['prices'] ?? []);

        return $event;  // Return newly created event

    } catch (QueryException $qe) {
        Log::error('Database error while saving event:', [
            'error_message' => $qe->getMessage(),
            'sql' => $qe->getSql(),
            'bindings' => $qe->getBindings(),
            'event_data' => $eventData,
        ]);
    } catch (\Exception $e) {
        Log::error('Failed to save event:', [
            'error_message' => $e->getMessage(),
            'event_data' => $eventData,
        ]);
    }

    // Return null if an exception occurs
    return null;
}


    private function saveEventLink(int $eventId, string $eventLink)
    {
        try {
            EventLink::create([
                'event_id' => $eventId,
                'url' => $eventLink,
                'link_type' => 'primary',
            ]);

            Log::info('Event link saved successfully:', ['event_id' => $eventId, 'url' => $eventLink]);
        } catch (QueryException $qe) {
            Log::error('Database error while saving event link:', [
                'error_message' => $qe->getMessage(),
                'sql' => $qe->getSql(),
                'bindings' => $qe->getBindings(),
                'event_id' => $eventId,
                'event_link' => $eventLink,
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to save event link:', [
                'error_message' => $e->getMessage(),
                'event_id' => $eventId,
                'event_link' => $eventLink,
            ]);
        }
    }

    private function isValidEventData(array $eventData)
    {
        $validator = Validator::make($eventData, [
            'title' => 'required|string',
            'date_start' => 'required|date',
            'date_end' => 'required|date',
        ]);

        if ($validator->fails()) {
            Log::warning('Invalid event data detected.', [
                'errors' => $validator->errors()->all(),
                'event_data' => $eventData,
            ]);
            return false;
        }

        Log::info('Event data is valid.');
        return true;
    }

    private function saveSchedules(Event $event, array $schedules)
    {
        foreach ($schedules as $schedule) {
            $timeEnd = !empty($schedule['time_end']) ? $schedule['time_end'] : null;

            $scheduleEntry = Schedule::updateOrCreate(
                [
                    'event_id' => $event->id,
                    'date' => $schedule['date'],
                ],
                [
                    'time_start' => $schedule['time_start'] ?? null,
                    'time_end' => $timeEnd,
                    'special_notes' => $schedule['special_notes'] ?? null,
                ]
            );
            Log::info('Schedule saved or updated:', ['schedule_id' => $scheduleEntry->id]);
        }
    }

    private function saveCategoriesAndTags(Event $event, array $eventData)
    {
        if (!empty($eventData['categories'])) {
            $categoryIds = [];
            foreach ($eventData['categories'] as $categoryName) {
                $category = Category::firstOrCreate(['name' => trim($categoryName)]);
                $categoryIds[] = $category->id;
            }
            $event->categories()->sync($categoryIds);
            Log::info('Categories synced for event:', ['event_id' => $event->id, 'category_ids' => $categoryIds]);
        } else {
            $event->categories()->sync([]);
        }

        if (!empty($eventData['tags'])) {
            $tagIds = [];
            foreach ($eventData['tags'] as $tagName) {
                $tag = Tag::firstOrCreate(['name' => trim($tagName)]);
                $tagIds[] = $tag->id;
            }
            $event->tags()->sync($tagIds);
            Log::info('Tags synced for event:', ['event_id' => $event->id, 'tag_ids' => $tagIds]);
        } else {
            $event->tags()->sync([]);
        }
    }

    private function saveImages(Event $event, ?string $primaryImageUrl, array $images)
    {
        if ($primaryImageUrl) {
            $image = Image::firstOrCreate(
                [
                    'event_id' => $event->id,
                    'image_url' => $primaryImageUrl,
                ],
                [
                    'alt_text' => 'Main Event Image',
                    'is_featured' => true,
                ]
            );
            Log::info('Primary image saved:', ['image_id' => $image->id]);
        }

        foreach ($images as $imageData) {
            if (!empty($imageData['image_url'])) {
                $image = Image::firstOrCreate(
                    [
                        'event_id' => $event->id,
                        'image_url' => $imageData['image_url'],
                    ],
                    [
                        'alt_text' => $imageData['alt_text'] ?? 'Additional Event Image',
                        'is_featured' => $imageData['is_featured'] ?? false,
                    ]
                );
                Log::info('Additional image saved or updated:', ['image_id' => $image->id]);
            }
        }
    }

    private function savePrices(Event $event, array $prices)
    {
        foreach ($prices as $priceData) {
            if (!empty($priceData['amount'])) {
                $price = Price::updateOrCreate(
                    [
                        'event_id' => $event->id,
                        'price_tier' => $priceData['price_tier'] ?? 'General',
                    ],
                    [
                        'amount' => $priceData['amount'],
                        'currency' => $priceData['currency'] ?? 'JPY',
                        'discount_info' => $priceData['discount_info'] ?? null,
                    ]
                );
                Log::info('Price saved or updated:', ['price_id' => $price->id]);
            }
        }
    }



private function analyzeTextWithOpenAI($eventData)
{
    $apiKey = env('OPENAI_API_KEY');  // Ensure the API key is set

    // Construct the prompt with explicit instructions
    $prompt = "
    Transform the provided event data into the specified JSON format with the following requirements:

    1. **Date Parsing**:
       - Parse 'raw_date' into 'date_start' and 'date_end':
         - If 'raw_date' contains a date range in the format 'YYYY.MM.DD (DAY) – MM.DD (DAY)', extract:
           - 'date_start' as 'YYYY-MM-DD' from the first date,
           - 'date_end' as 'YYYY-MM-DD' using the same year as 'date_start', but replacing the month and day.
         - If 'raw_date' contains only a single date, set both 'date_start' and 'date_end' to the same value.
         - Ensure 'date_start' is not after 'date_end'.

    2. **Schedule Parsing**:
       - Parse 'raw_schedule' into an array of schedules:
         - Each schedule should include 'date', 'time_start', 'time_end', and 'special_notes'.
         - Use the date from 'raw_date' to populate the 'date' field for each schedule entry.
         - If 'raw_schedule' contains multiple entries on different days, separate them into individual schedule objects.
         - If 'time_end' is not specified, leave it empty.
       - If 'raw_schedule' is empty or unavailable, set 'schedule' as an empty array.

    3. **Category Assignment**:
       - Assign one or more of the following predefined categories based on keywords in the 'title' and 'description':
         ['Music', 'Theatre', 'Dance', 'Art', 'Workshop', 'Tour', 'Festival', 'Family', 'Wellness', 'Sports']

    4. **Tag Assignment**:
       - Assign one or more of the following predefined tags based on keywords in the 'title' and 'description':
         ['Classical Music', 'Contemporary Music', 'Jazz', 'Opera', 'Ballet', 'Modern Dance', 'Experimental Theatre', 'Drama', 'Stand-Up Comedy', 'Art Exhibition', 'Photography', 'Painting', 'Sculpture', 'Creative Workshop', 'Cooking Class', 'Wine Tasting', 'Wellness Retreat', 'Meditation', 'Yoga', 'Marathon', 'Kids Activities', 'Outdoor Adventure', 'Walking Tour', 'Historical Tour', 'Book Reading', 'Poetry Slam', 'Cultural Festival', 'Film Screening', 'Anime', 'Networking Event', 'Startup Event', 'Tech Conference', 'Fashion Show', 'Food Festival', 'Pop-up Market', 'Charity Event', 'Community Event', 'Traditional Arts', 'Ritual/Ceremony', 'Virtual Event']

    5. **Price Parsing**:
       - Extract pricing information from 'raw_price_text' and format it as an array of price objects:
         - Each price object should include 'price_tier', 'amount', and 'currency'.
         - 'price_tier' should represent the ticket type or seating type, including any relevant notes (e.g., 'General (1F)', 'S', '25 and Under', 'Repeat ticket').
         - 'amount' should be the numeric value of the price, excluding currency symbols (e.g., '6000', '4000').
         - Assume 'currency' to be 'JPY' if no currency is provided in 'raw_price_text'.
         - Include 'discount_info' if additional information about discounts or conditions is present in 'raw_price_text'.
         - If pricing varies by date, split these into separate price objects with the relevant details.
       - Example 1: For 'raw_price_text': 'General (1F): ¥6,000 / General (2F): ¥5,000 / 25 and Under: ¥3,000 / 18 and Under: ¥1,000', the output should be:
         [
             { \"price_tier\": \"General (1F)\", \"amount\": \"6000\", \"currency\": \"JPY\" },
             { \"price_tier\": \"General (2F)\", \"amount\": \"5000\", \"currency\": \"JPY\" },
             { \"price_tier\": \"25 and Under\", \"amount\": \"3000\", \"currency\": \"JPY\" },
             { \"price_tier\": \"18 and Under\", \"amount\": \"1000\", \"currency\": \"JPY\" }
         ]

    6. **Output Format**:
       - Ensure the output strictly follows the specified JSON format, even if some fields (e.g., 'categories', 'tags', 'prices') are empty:
         {
             \"events\": [
                 {
                     \"title\": \"Event Title\",
                     \"date_start\": \"YYYY-MM-DD\",
                     \"date_end\": \"YYYY-MM-DD\",
                     \"schedule\": [
                         {
                             \"date\": \"YYYY-MM-DD\",
                             \"time_start\": \"HH:mm:ss\",
                             \"time_end\": \"HH:mm:ss\",
                             \"special_notes\": \"Special Notes\"
                         }
                     ],
                     \"categories\": [\"Category1\", \"Category2\"],
                     \"tags\": [\"Tag1\", \"Tag2\"],
                     \"prices\": [
                         {
                             \"price_tier\": \"Tier1\",
                             \"amount\": \"1000\",
                             \"currency\": \"JPY\",
                             \"discount_info\": \"Discount Info\"
                         }
                     ]
                 }
             ]
         }
         
    7. **Edge Case Handling**:
       - Handle any edge cases or unexpected formats gracefully, ensuring that the output structure remains consistent and valid.

    EVENT DATA TO BE PARSED: " . json_encode($eventData);

    $messages = [
        [
            'role' => 'user',
            'content' => $prompt,
        ]
    ];

    try {
        // Make the API request to OpenAI
        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $apiKey,
        ])->timeout(60)->post('https://api.openai.com/v1/chat/completions', [
            'model' => 'gpt-4o-mini',
            'messages' => $messages,
            'max_tokens' => 600,
            'temperature' => 0.2,
        ]);

        $responseArray = $response->json();
        Log::info('OpenAI GPT Response:', ['response' => $responseArray]);

        // Check if 'choices' and 'message' keys exist in the response
        if (!isset($responseArray['choices'][0]['message']['content'])) {
            throw new \Exception('Invalid response format from OpenAI.');
        }

        // Extract the response content
        $parsedData = $responseArray['choices'][0]['message']['content'];

        // Use regex to extract JSON block
        if (preg_match('/\{.*\}/s', $parsedData, $matches)) {
            $cleanedData = $matches[0];
        } else {
            // If regex fails, log and return null
            Log::warning('Failed to extract JSON from OpenAI response.', ['parsed_data' => $parsedData]);
            return null;
        }

        // Log the cleaned data
        Log::info('Cleaned data for JSON decoding:', ['cleaned_data' => $cleanedData]);

        // Decode the JSON
        $decodedData = json_decode($cleanedData, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \Exception('JSON decoding error: ' . json_last_error_msg());
        }

        // Log the decoded data
        Log::info('Decoded data from OpenAI response:', ['decoded_data' => $decodedData]);

        return $decodedData;

    } catch (\Exception $e) {
        Log::error('Error with OpenAI API request:', [
            'error_message' => $e->getMessage(),
            'event_data' => $eventData,
        ]);
        return null;
    }
}



    /**
     * Save processed event data to the database.
     *
     * @param  array  $eventData
     * @return void
     */
  
}
