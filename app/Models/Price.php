<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Price extends Model
{
    // Define fillable fields to protect against mass assignment
    protected $fillable = [
        'event_id',
        'price_tier',
        'amount',
        'currency',
        'discount_info',
    ];

    /**
     * Define the relationship with the Event model.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function event()
    {
        return $this->belongsTo(Event::class);
    }
}
