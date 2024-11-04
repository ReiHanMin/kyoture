<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Event extends Model
{
    use HasFactory;

    // Define fillable fields to protect against mass assignment
    protected $fillable = [
        'title',
        'organization',
        'description',
        'date_start',
        'date_end',
        'time_start',
        'time_end',
        'venue_id',
        'address',
        'external_id',
    ];

    /**
     * Define the relationship with the Venue model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function venue()
    {
        return $this->belongsTo(Venue::class);
    }

    /**
     * Define the relationship with the Price model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function prices()
    {
        return $this->hasMany(Price::class);
    }

    /**
     * Define the relationship with the Schedule model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function schedules()
    {
        return $this->hasMany(Schedule::class);
    }

    /**
     * Define the relationship with the Image model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function images()
    {
        return $this->hasMany(Image::class);
    }

    /**
     * Define the relationship with the EventCategory model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function categories()
    {
        return $this->belongsToMany(Category::class, 'event_categories');
    }

    /**
     * Define the relationship with the Tag model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function tags()
    {
        return $this->belongsToMany(Tag::class, 'event_tags');
    }

    public function eventLinks()
    {
    return $this->hasMany(EventLink::class);
    }

}
